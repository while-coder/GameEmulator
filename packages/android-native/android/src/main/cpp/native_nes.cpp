#include <jni.h>
#include <android/native_window_jni.h>
#include <android/log.h>
#include <EGL/egl.h>
#include <GLES2/gl2.h>
#include <oboe/Oboe.h>
#include <libretro.h>
#include <atomic>
#include <array>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdarg>
#include <cstring>
#include <fstream>
#include <map>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <thread>
#include <vector>
#include <sys/resource.h>
#include <dlfcn.h>

namespace {
using Clock = std::chrono::steady_clock;
constexpr size_t AudioCapacity = 32768; // stereo frames, power of two
class Engine;
Engine* active = nullptr; // libretro has process-global callbacks; one session per APK
struct CoreApi {
    void* library = nullptr;
#define CORE_FUNCTIONS(X) X(init) X(deinit) X(set_environment) X(set_video_refresh) X(set_audio_sample) X(set_audio_sample_batch) X(set_input_poll) X(set_input_state) X(load_game) X(unload_game) X(get_system_av_info) X(set_controller_port_device) X(run) X(reset) X(serialize_size) X(serialize) X(unserialize) X(get_memory_size) X(get_memory_data)
#define DECLARE(name) decltype(&retro_##name) name = nullptr;
    CORE_FUNCTIONS(DECLARE)
#undef DECLARE
    void open(const char* name) {
        if (library) { dlclose(library); library = nullptr; }
        library = dlopen(name, RTLD_NOW | RTLD_LOCAL);
        if (!library) throw std::runtime_error(std::string("内核加载失败：") + dlerror());
#define RESOLVE(name) name = reinterpret_cast<decltype(name)>(dlsym(library, "retro_" #name)); if (!name) throw std::runtime_error("内核接口缺失：retro_" #name);
        CORE_FUNCTIONS(RESOLVE)
#undef RESOLVE
    }
    ~CoreApi() { if (library) dlclose(library); }
};
void logCore(enum retro_log_level level, const char* format, ...) {
    va_list args; va_start(args, format);
    __android_log_vprint(level >= RETRO_LOG_ERROR ? ANDROID_LOG_ERROR : ANDROID_LOG_INFO,
                        "FCEUmm", format, args);
    va_end(args);
}
class Engine : public oboe::AudioStreamDataCallback, public oboe::AudioStreamErrorCallback {
public:
    CoreApi core;
    std::mutex mutex;
    std::condition_variable wake;
    std::thread worker;
    bool stop = false, loaded = false, initialized = false, paused = true;
    std::atomic<bool> audible{false}, audioFailed{false};
    std::atomic<bool> audioPriming{true};
    std::atomic<size_t> audioTarget{1600};
    std::atomic<float> volume{1};
    std::atomic<uint32_t> buttons[2]{};
    std::atomic<uint32_t> turboButtons[2]{};
    std::atomic<double> turboHz{16};
    std::atomic<uint64_t> frames{0}, presented{0}, late{0}, underruns{0};
    std::atomic<double> runMs{0};
    double fps = 60.0988, speed = 1;
    std::string baseDirectory, directory, saveDirectory, batteryPath, gamePath;
    unsigned rotation = 0;
    double geometryAspect = 4.0/3.0;
    std::vector<uint8_t> rom, pixels;
    std::vector<char> lastBattery;
    std::map<std::string, std::string> options;
    unsigned width = 0, height = 0, pixelFormat = RETRO_PIXEL_FORMAT_RGB565;
    bool dirty = false, smooth = false, scanlines = false;
    std::array<int16_t, AudioCapacity * 2> audio{};
    std::atomic<uint64_t> audioRead{0}, audioWrite{0};
    std::shared_ptr<oboe::AudioStream> stream;
    ANativeWindow* window = nullptr;
    bool surfaceChanged = false;
    EGLDisplay display = EGL_NO_DISPLAY;
    EGLSurface surface = EGL_NO_SURFACE;
    EGLContext context = EGL_NO_CONTEXT;
    GLuint program = 0, texture = 0;
    unsigned textureWidth = 0, textureHeight = 0, texturePixelFormat = 0;
    std::string error;
    Clock::time_point started = Clock::now();

    explicit Engine(std::string dir) : baseDirectory(dir), directory(dir), saveDirectory(std::move(dir)) {
        if (active) throw std::runtime_error("原生游戏会话已存在");
        active = this;
        worker = std::thread([this] { loop(); });
    }
    ~Engine() {
        { std::lock_guard<std::mutex> guard(mutex); stop = true; audible = false; }
        wake.notify_all();
        worker.join();
        closeAudio();
        try { unload(); } catch (const std::exception& e) { __android_log_print(ANDROID_LOG_ERROR,"FCEUmm","%s",e.what()); }
        if (window) ANativeWindow_release(window);
        active = nullptr;
    }
    void closeAudio() {
        if (stream) { stream->requestStop(); stream->close(); stream.reset(); }
    }
    void battery(bool save) {
        auto size = core.get_memory_size(RETRO_MEMORY_SAVE_RAM);
        auto* data = static_cast<char*>(core.get_memory_data(RETRO_MEMORY_SAVE_RAM));
        if (!data || !size || size > 1024 * 1024 || batteryPath.empty()) return;
        if (save) {
            if (lastBattery.size() == size && std::memcmp(lastBattery.data(), data, size) == 0) return;
            auto path = batteryPath + ".tmp";
            std::ofstream out(path, std::ios::binary | std::ios::trunc);
            out.write(data, static_cast<std::streamsize>(size)); out.close();
            if (!out || std::rename(path.c_str(), batteryPath.c_str()) != 0)
                throw std::runtime_error("游戏内存档写入失败，原文件已保留");
            lastBattery.assign(data, data + size);
        } else {
            std::ifstream in(batteryPath, std::ios::binary | std::ios::ate);
            if (!in) return;
            if (in.tellg() != static_cast<std::streamoff>(size))
                throw std::runtime_error("游戏内存档大小不匹配，原文件已保留");
            in.seekg(0); std::vector<char> saved(size); in.read(saved.data(), size);
            if (!in) throw std::runtime_error("游戏内存档读取失败");
            std::memcpy(data, saved.data(), size);
            lastBattery = std::move(saved);
        }
    }
    void unload() {
        std::exception_ptr failure;
        if (loaded) { try { battery(true); } catch (...) { failure=std::current_exception(); } core.unload_game(); loaded = false; }
        if (initialized) { core.deinit(); initialized = false; }
        pixels.clear(); rom.clear(); options.clear(); lastBattery.clear(); width = height = 0;
        if (failure) std::rethrow_exception(failure);
    }
    void load(std::vector<uint8_t> bytes, const std::string& hash, bool arcade, std::string path) {
        std::lock_guard<std::mutex> guard(mutex);
        paused = true; audible = false; closeAudio(); unload(); error.clear();
        core.open(arcade ? "libfbalpha2012.so" : "libfceumm.so");
        gamePath = arcade ? std::move(path) : "game.nes";
        directory = arcade ? gamePath.substr(0,gamePath.find_last_of('/')) : baseDirectory;
        saveDirectory = arcade ? baseDirectory + "/arcade" : baseDirectory;
        rom = std::move(bytes); batteryPath = saveDirectory + "/" + hash + ".srm";
        rotation = 0; geometryAspect = 4.0/3.0;
        pixelFormat = RETRO_PIXEL_FORMAT_RGB565;
        try {
            core.set_environment(environment); core.set_video_refresh(video);
            core.set_audio_sample(sample); core.set_audio_sample_batch(batch);
            core.set_input_poll([] {}); core.set_input_state(input);
            core.init(); initialized = true;
            retro_game_info game{gamePath.c_str(), arcade ? nullptr : rom.data(), arcade ? 0 : rom.size(), nullptr};
            if (!core.load_game(&game)) throw std::runtime_error(arcade ? "FB Alpha 无法加载此游戏，请检查 FBA 0.2.97.29 ROM、父包和 BIOS" : "FCEUmm 无法加载此游戏");
            loaded = true;
            retro_system_av_info av{}; core.get_system_av_info(&av);
            geometryAspect = av.geometry.aspect_ratio > 0 ? av.geometry.aspect_ratio : static_cast<double>(av.geometry.base_width) / std::max(1u,av.geometry.base_height);
            fps = av.timing.fps;
            if (!std::isfinite(fps) || fps < 40 || fps > 70 ||
                !std::isfinite(av.timing.sample_rate) || av.timing.sample_rate < 8000 || av.timing.sample_rate > 96000)
                throw std::runtime_error("内核音视频时钟无效");
            oboe::AudioStreamBuilder builder;
            builder.setDirection(oboe::Direction::Output)->setFormat(oboe::AudioFormat::I16)
                ->setChannelCount(2)->setSampleRate(static_cast<int32_t>(av.timing.sample_rate))
                ->setPerformanceMode(oboe::PerformanceMode::LowLatency)
                ->setSharingMode(oboe::SharingMode::Shared)->setUsage(oboe::Usage::Game)
                ->setFormatConversionAllowed(true)
                ->setSampleRateConversionQuality(oboe::SampleRateConversionQuality::Medium)
                ->setDataCallback(this)->setErrorCallback(this);
            auto result = builder.openStream(stream);
            if (result != oboe::Result::OK) throw std::runtime_error(std::string("音频初始化失败：") + oboe::convertToText(result));
            stream->setBufferSizeInFrames(stream->getFramesPerBurst() * 3);
            battery(false); core.run();
            core.set_controller_port_device(0, RETRO_DEVICE_JOYPAD);
            core.set_controller_port_device(1, RETRO_DEVICE_JOYPAD);
            audioRead = 0; audioWrite = 0; audioFailed = false;
            audioTarget = static_cast<size_t>(av.timing.sample_rate / fps * 2);
            audioPriming = true;
            frames = presented = late = underruns = 0; runMs = 0;
            buttons[0] = buttons[1] = 0; started = Clock::now();
            result = stream->requestStart();
            if (result != oboe::Result::OK) throw std::runtime_error("声音输出启动失败");
        } catch (...) {
            closeAudio();
            if (loaded) { core.unload_game(); loaded = false; }
            if (initialized) { core.deinit(); initialized = false; }
            throw;
        }
    }
    static bool environment(unsigned command, void* data) {
        auto* e = active;
        switch (command) {
        case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
            static_cast<retro_log_callback*>(data)->log = logCore; return true;
        case RETRO_ENVIRONMENT_GET_CAN_DUPE: *static_cast<bool*>(data) = true; return true;
        case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: {
            unsigned value = *static_cast<unsigned*>(data);
            if (value > RETRO_PIXEL_FORMAT_RGB565) return false;
            e->pixelFormat = value; return true;
        }
        case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
            *static_cast<const char**>(data) = e->saveDirectory.c_str(); return true;
        case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
            *static_cast<const char**>(data) = e->directory.c_str(); return true;
        case RETRO_ENVIRONMENT_SET_ROTATION: e->rotation=*static_cast<unsigned*>(data)%4; return true;
        case RETRO_ENVIRONMENT_SET_GEOMETRY: {
            auto* geometry=static_cast<retro_game_geometry*>(data);
            if(geometry->aspect_ratio>0)e->geometryAspect=geometry->aspect_ratio;
            return true;
        }
        case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION: *static_cast<unsigned*>(data) = 0; return true;
        case RETRO_ENVIRONMENT_SET_VARIABLES: {
            auto* variable = static_cast<retro_variable*>(data);
            for (; variable && variable->key; ++variable) {
                std::string value = variable->value ? variable->value : "";
                auto start = value.find(';'); if (start == std::string::npos) continue;
                value = value.substr(start + 1); start = value.find_first_not_of(' ');
                if (start != std::string::npos) value = value.substr(start);
                e->options[variable->key] = value.substr(0, value.find('|'));
                if(std::string(variable->key).find("neogeo_mode")!=std::string::npos && value.find("MVS")!=std::string::npos) e->options[variable->key]="MVS";
            }
            return true;
        }
        case RETRO_ENVIRONMENT_GET_VARIABLE: {
            auto* variable = static_cast<retro_variable*>(data);
            auto found = e->options.find(variable->key);
            variable->value = found == e->options.end() ? nullptr : found->second.c_str();
            return variable->value != nullptr;
        }
        case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: *static_cast<bool*>(data) = false; return true;
        case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS: return true;
        case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
        case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
        case RETRO_ENVIRONMENT_SET_PERFORMANCE_LEVEL: return true;
        default: return false;
        }
    }
    static int16_t input(unsigned port, unsigned device, unsigned index, unsigned id) {
        if (port >= 2 || device != RETRO_DEVICE_JOYPAD || index) return 0;
        auto value = active->buttons[port].load(std::memory_order_relaxed);
        double seconds = std::chrono::duration<double>(Clock::now().time_since_epoch()).count();
        if (static_cast<uint64_t>(seconds * active->turboHz * 2) % 2 == 0)
            value |= active->turboButtons[port].load(std::memory_order_relaxed);
        if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return static_cast<int16_t>(value);
        return id < 16 && (value & (1u << id)) ? 1 : 0;
    }
    static void video(const void* data, unsigned w, unsigned h, size_t pitch) {
        auto* e = active;
        if (!data || w == 0 || h == 0 || w > 1024 || h > 1024) return;
        size_t bpp = e->pixelFormat == RETRO_PIXEL_FORMAT_XRGB8888 ? 4 : 2;
        e->pixels.resize(w * h * bpp); e->width = w; e->height = h;
        for (unsigned y = 0; y < h; ++y) {
            auto* src = static_cast<const uint8_t*>(data) + y * pitch;
            auto* dst = e->pixels.data() + y * w * bpp;
            if (e->pixelFormat != RETRO_PIXEL_FORMAT_0RGB1555) std::memcpy(dst,src,w*bpp);
            else for (unsigned x=0;x<w;++x) {
                uint16_t c; std::memcpy(&c,src+x*2,2);
                uint16_t rgb565=static_cast<uint16_t>(((c&0x7fe0)<<1)|((c&0x0200)>>4)|(c&31));
                std::memcpy(dst+x*2,&rgb565,2);
            }
        }
        e->dirty = true;
    }
    static void sample(int16_t l, int16_t r) { int16_t pair[]{l,r}; batch(pair, 1); }
    static size_t batch(const int16_t* data, size_t count) {
        auto* e = active;
        if (!e->audible || e->speed != 1) return count;
        auto write = e->audioWrite.load(std::memory_order_relaxed);
        auto read = e->audioRead.load(std::memory_order_acquire);
        size_t available = AudioCapacity - std::min<uint64_t>(write - read, AudioCapacity);
        size_t size = std::min(count, available);
        for (size_t i = 0; i < size; ++i) {
            auto pos = ((write + i) & (AudioCapacity - 1)) * 2;
            e->audio[pos] = data[i * 2]; e->audio[pos + 1] = data[i * 2 + 1];
        }
        e->audioWrite.store(write + size, std::memory_order_release);
        return count;
    }
    oboe::DataCallbackResult onAudioReady(oboe::AudioStream*, void* output, int32_t count) override {
        auto* dst = static_cast<int16_t*>(output);
        std::memset(dst, 0, count * 4);
        if (!audible) { audioRead.store(audioWrite.load(std::memory_order_acquire), std::memory_order_release); return oboe::DataCallbackResult::Continue; }
        auto read = audioRead.load(std::memory_order_relaxed);
        auto write = audioWrite.load(std::memory_order_acquire);
        if (audioPriming) {
            if (write - read < audioTarget) return oboe::DataCallbackResult::Continue;
            audioPriming = false;
        }
        size_t size = std::min<uint64_t>(count, write - read);
        float gain = volume.load(std::memory_order_relaxed);
        for (size_t i = 0; i < size; ++i) {
            auto pos = ((read + i) & (AudioCapacity - 1)) * 2;
            dst[i * 2] = static_cast<int16_t>(audio[pos] * gain);
            dst[i * 2 + 1] = static_cast<int16_t>(audio[pos + 1] * gain);
        }
        audioRead.store(read + size, std::memory_order_release);
        if (size < static_cast<size_t>(count)) ++underruns;
        return oboe::DataCallbackResult::Continue;
    }
    void onErrorAfterClose(oboe::AudioStream*, oboe::Result) override { audioFailed = true; }
    void destroyGl() {
        if (display != EGL_NO_DISPLAY) {
            eglMakeCurrent(display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
            if (surface != EGL_NO_SURFACE) eglDestroySurface(display, surface);
            if (context != EGL_NO_CONTEXT) eglDestroyContext(display, context);
            eglTerminate(display);
        }
        display = EGL_NO_DISPLAY; surface = EGL_NO_SURFACE; context = EGL_NO_CONTEXT;
        program = texture = 0;
        textureWidth = textureHeight = texturePixelFormat = 0;
    }
    GLuint shader(GLenum kind, const char* text) {
        GLuint id = glCreateShader(kind); glShaderSource(id, 1, &text, nullptr); glCompileShader(id);
        GLint ok = 0; glGetShaderiv(id, GL_COMPILE_STATUS, &ok);
        if (!ok) { glDeleteShader(id); throw std::runtime_error("原生图形着色器初始化失败"); }
        return id;
    }
    void render() {
        if (!window || pixels.empty()) return;
        if (display == EGL_NO_DISPLAY) {
            display = eglGetDisplay(EGL_DEFAULT_DISPLAY);
            if (display == EGL_NO_DISPLAY || !eglInitialize(display, nullptr, nullptr)) throw std::runtime_error("EGL 初始化失败");
            EGLint attributes[]{EGL_RENDERABLE_TYPE,EGL_OPENGL_ES2_BIT,EGL_SURFACE_TYPE,EGL_WINDOW_BIT,EGL_RED_SIZE,8,EGL_GREEN_SIZE,8,EGL_BLUE_SIZE,8,EGL_NONE};
            EGLConfig config; EGLint count = 0;
            if (!eglChooseConfig(display, attributes, &config, 1, &count) || !count) throw std::runtime_error("EGL 配置失败");
            EGLint ctx[]{EGL_CONTEXT_CLIENT_VERSION,2,EGL_NONE};
            context = eglCreateContext(display, config, EGL_NO_CONTEXT, ctx);
            surface = eglCreateWindowSurface(display, config, window, nullptr);
            if (context == EGL_NO_CONTEXT || surface == EGL_NO_SURFACE || !eglMakeCurrent(display, surface, surface, context)) throw std::runtime_error("游戏画面创建失败");
            eglSwapInterval(display, 0);
            auto vs = shader(GL_VERTEX_SHADER,"attribute vec2 p;attribute vec2 t;varying vec2 uv;void main(){gl_Position=vec4(p,0.,1.);uv=t;}");
            auto fs = shader(GL_FRAGMENT_SHADER,"precision mediump float;uniform sampler2D image;uniform float lines;uniform float rows;uniform int xrgb;varying vec2 uv;void main(){vec4 c=texture2D(image,uv);float f=mod(floor(uv.y*rows),2.);vec3 rgb=xrgb==1?c.bgr:c.rgb;gl_FragColor=vec4(rgb*(1.-lines*f*.2),1.);}");
            program = glCreateProgram(); glAttachShader(program, vs); glAttachShader(program, fs); glLinkProgram(program);
            glDeleteShader(vs); glDeleteShader(fs);
            GLint ok = 0; glGetProgramiv(program, GL_LINK_STATUS, &ok);
            if (!ok) throw std::runtime_error("游戏画面程序链接失败");
            glGenTextures(1, &texture); glBindTexture(GL_TEXTURE_2D, texture);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glPixelStorei(GL_UNPACK_ALIGNMENT,1);
        }
        EGLint w=0,h=0; eglQuerySurface(display,surface,EGL_WIDTH,&w); eglQuerySurface(display,surface,EGL_HEIGHT,&h);
        glViewport(0,0,w,h); glUseProgram(program); glBindTexture(GL_TEXTURE_2D,texture);
        glUniform1f(glGetUniformLocation(program,"lines"),scanlines ? 1.f : 0.f);
        glUniform1f(glGetUniformLocation(program,"rows"),static_cast<float>(height));
        glUniform1i(glGetUniformLocation(program,"xrgb"),pixelFormat==RETRO_PIXEL_FORMAT_XRGB8888 ? 1 : 0);
        glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,smooth ? GL_LINEAR : GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,smooth ? GL_LINEAR : GL_NEAREST);
        GLenum format=pixelFormat==RETRO_PIXEL_FORMAT_XRGB8888 ? GL_RGBA : GL_RGB;
        GLenum type=pixelFormat==RETRO_PIXEL_FORMAT_XRGB8888 ? GL_UNSIGNED_BYTE : GL_UNSIGNED_SHORT_5_6_5;
        if(textureWidth!=width||textureHeight!=height||texturePixelFormat!=pixelFormat) {
            glTexImage2D(GL_TEXTURE_2D,0,format,width,height,0,format,type,pixels.data());
            textureWidth=width; textureHeight=height; texturePixelFormat=pixelFormat;
        } else glTexSubImage2D(GL_TEXTURE_2D,0,0,0,width,height,format,type,pixels.data());
        const GLfloat positions[]{-1,-1, 1,-1, -1,1, 1,1};
        GLfloat uv[]{0,1, 1,1, 0,0, 1,0};
        for(unsigned r=0;r<rotation;++r)for(unsigned i=0;i<8;i+=2) { float u=uv[i]; uv[i]=1-uv[i+1]; uv[i+1]=u; }
        auto p=glGetAttribLocation(program,"p"),t=glGetAttribLocation(program,"t");
        glVertexAttribPointer(p,2,GL_FLOAT,GL_FALSE,0,positions); glEnableVertexAttribArray(p);
        glVertexAttribPointer(t,2,GL_FLOAT,GL_FALSE,0,uv); glEnableVertexAttribArray(t);
        glDrawArrays(GL_TRIANGLE_STRIP,0,4);
        if (!eglSwapBuffers(display,surface)) throw std::runtime_error("游戏画面提交失败");
        ++presented; dirty=false;
    }
    void loop() {
        setpriority(PRIO_PROCESS, 0, -8);
        std::unique_lock<std::mutex> guard(mutex);
        auto next=Clock::now();
        while (!stop) {
            if (surfaceChanged) { destroyGl(); surfaceChanged = false; }
            if (!loaded || paused || !window) {
                if (!window) destroyGl();
                wake.wait_for(guard,std::chrono::milliseconds(20)); next=Clock::now(); continue;
            }
            try {
                if (audioFailed) throw std::runtime_error("音频设备已变化，请重新打开游戏");
                auto begin=Clock::now(); core.run(); ++frames;
                runMs = runMs.load() * .95 + std::chrono::duration<double,std::milli>(Clock::now()-begin).count() * .05;
                if (dirty) render();
                if (frames % 300 == 0) battery(true);
                // Keep audio near two frames of buffering, correcting small device clock
                // drift without accumulating seconds of latency or blocking audio callbacks.
                double correction=1;
                if (speed==1 && !audioPriming) {
                    auto queued=audioWrite.load()-audioRead.load();
                    if (queued<audioTarget/2) correction=.99;
                    else if (queued>audioTarget*2) correction=1.01;
                }
                auto period=std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(correction/(fps*speed)));
                next+=period;
                if (Clock::now()>next+period) { ++late; next=Clock::now(); }
                wake.wait_until(guard,next,[this]{return stop || paused || !window;});
            } catch (const std::exception& e) { error=e.what(); paused=true; audible=false; }
        }
        destroyGl();
    }
};
Engine* engine(jlong handle) { return reinterpret_cast<Engine*>(handle); }
std::string string(JNIEnv* env, jstring value) {
    const char* chars=env->GetStringUTFChars(value,nullptr);
    std::string result(chars); env->ReleaseStringUTFChars(value,chars); return result;
}
void fail(JNIEnv* env, const std::exception& e) { env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),e.what()); }
}
#define JNI(name) Java_com_whilecode_gameemulator_nativecore_NativeEmulator_##name
extern "C" JNIEXPORT jlong JNICALL JNI(create)(JNIEnv* env,jobject,jstring directory) {
    try { return reinterpret_cast<jlong>(new Engine(string(env,directory))); }
    catch(const std::exception& e) { fail(env,e); return 0; }
}
extern "C" JNIEXPORT void JNICALL JNI(destroy)(JNIEnv* env,jobject,jlong handle) {
    try { delete engine(handle); } catch(const std::exception& e) { fail(env,e); }
}
extern "C" JNIEXPORT void JNICALL JNI(load)(JNIEnv* env,jobject,jlong handle,jbyteArray bytes,jstring hash,jboolean arcade,jstring path) {
    try {
        std::vector<uint8_t> data(env->GetArrayLength(bytes));
        env->GetByteArrayRegion(bytes,0,data.size(),reinterpret_cast<jbyte*>(data.data()));
        engine(handle)->load(std::move(data),string(env,hash),arcade,string(env,path));
    } catch(const std::exception& e) { fail(env,e); }
}
extern "C" JNIEXPORT void JNICALL JNI(setSurface)(JNIEnv* env,jobject,jlong handle,jobject value) {
    auto* e=engine(handle); std::lock_guard<std::mutex> guard(e->mutex);
    // EGL objects must be destroyed by their owning worker before replacing a window.
    // Kotlin destroys/replaces a surface only while the session is paused.
    if (e->window) ANativeWindow_release(e->window);
    e->window=value ? ANativeWindow_fromSurface(env,value) : nullptr;
    e->surfaceChanged=true;
    e->wake.notify_all();
}
extern "C" JNIEXPORT void JNICALL JNI(control)(JNIEnv* env,jobject,jlong handle,jstring action,jdouble value) {
    auto* e=engine(handle); std::lock_guard<std::mutex> guard(e->mutex);
    try {
        auto op=string(env,action);
        if(op=="pause") {
            e->paused=true; e->audible=false; e->audioPriming=true; e->buttons[0]=e->buttons[1]=0;
            if(e->stream && e->stream->requestPause()!=oboe::Result::OK)e->stream->requestStop();
            if(e->loaded)e->battery(true);
        }
        else if(op=="resume" && e->loaded) {
            if(!e->error.empty())throw std::runtime_error(e->error);
            if(e->stream && e->stream->requestStart()!=oboe::Result::OK)throw std::runtime_error("声音输出恢复失败");
            e->paused=false; e->audible=e->speed==1;
        }
        else if(op=="volume") e->volume=std::clamp(static_cast<float>(value),0.0f,1.0f);
        else if(op=="speed") { e->speed=std::clamp(static_cast<double>(value),0.5,3.0); e->audioPriming=true; e->audible=e->loaded&&!e->paused&&e->speed==1; }
        else if(op=="smoothing") e->smooth=value!=0;
        else if(op=="scanlines") e->scanlines=value!=0;
        else if(op=="reset" && e->loaded) { e->core.reset(); e->buttons[0]=e->buttons[1]=0; }
        else if(op=="stop") { e->paused=true; e->audible=false; e->closeAudio(); e->unload(); }
        e->wake.notify_all();
    } catch(const std::exception& ex) { fail(env,ex); }
}
extern "C" JNIEXPORT void JNICALL JNI(buttons)(JNIEnv*,jobject,jlong handle,jint player,jint mask) {
    if(player>=0&&player<2)engine(handle)->buttons[player]=static_cast<uint32_t>(mask);
}
extern "C" JNIEXPORT void JNICALL JNI(turbo)(JNIEnv*,jobject,jlong handle,jint player,jint mask,jdouble hz) {
    if(player>=0&&player<2) { engine(handle)->turboButtons[player]=static_cast<uint32_t>(mask); engine(handle)->turboHz=hz; }
}
extern "C" JNIEXPORT jbyteArray JNICALL JNI(save)(JNIEnv* env,jobject,jlong handle) {
    auto* e=engine(handle); std::lock_guard<std::mutex> guard(e->mutex);
    try {
        if(!e->loaded)throw std::runtime_error("请先启动游戏");
        auto size=e->core.serialize_size();
        if(!size||size>8*1024*1024)throw std::runtime_error("存档大小异常");
        std::vector<uint8_t> data(size);
        if(!e->core.serialize(data.data(),size))throw std::runtime_error("内核保存进度失败");
        auto result=env->NewByteArray(size); env->SetByteArrayRegion(result,0,size,reinterpret_cast<jbyte*>(data.data())); return result;
    } catch(const std::exception& ex) { fail(env,ex); return nullptr; }
}
extern "C" JNIEXPORT void JNICALL JNI(restore)(JNIEnv* env,jobject,jlong handle,jbyteArray bytes) {
    auto* e=engine(handle); std::lock_guard<std::mutex> guard(e->mutex);
    try {
        size_t size=env->GetArrayLength(bytes);
        if(!e->loaded||!size||size!=e->core.serialize_size())throw std::runtime_error("存档与当前内核不匹配");
        std::vector<uint8_t> data(size),previous(size);
        env->GetByteArrayRegion(bytes,0,size,reinterpret_cast<jbyte*>(data.data()));
        if(!e->core.serialize(previous.data(),size))throw std::runtime_error("无法保护当前进度");
        if(!e->core.unserialize(data.data(),size)) { e->core.unserialize(previous.data(),size); throw std::runtime_error("存档读取失败，已尝试恢复当前进度"); }
        e->buttons[0]=e->buttons[1]=0;
    } catch(const std::exception& ex) { fail(env,ex); }
}
extern "C" JNIEXPORT jstring JNICALL JNI(stats)(JNIEnv* env,jobject,jlong handle) {
    auto* e=engine(handle); std::lock_guard<std::mutex> guard(e->mutex);
    std::ostringstream out; out<<"{\"frames\":"<<e->frames<<",\"presented\":"<<e->presented
        <<",\"lateFrames\":"<<e->late<<",\"audioUnderruns\":"<<e->underruns
        <<",\"runMs\":"<<e->runMs<<",\"targetFps\":"<<e->fps<<",\"aspect\":"<<e->geometryAspect<<",\"failed\":"<<(!e->error.empty()?"true":"false")<<"}";
    return env->NewStringUTF(out.str().c_str());
}
extern "C" JNIEXPORT jstring JNICALL JNI(lastError)(JNIEnv* env,jobject,jlong handle) {
    auto* e=engine(handle); std::lock_guard<std::mutex> guard(e->mutex);
    return env->NewStringUTF(e->error.c_str());
}
