# Pinned, offline cartridge cores. Build only their libretro interfaces.
unpack(mgba-7a12d6d4.tar.gz 5cbf639e527fb586bf33e14d59037eab35f78f45154e0b79c784fff474c3bc37 mgba-7a12d6d4b9acb14c0ae62c9166b6a2f3d08007f6)
unpack(snes9x-204ea1c0.tar.gz 506b07a775401f9357258fdae0fb0638a6e0f82093657d294aa51c046dcee67c snes9x-204ea1c0b851f960cbf223075eb1c25641cb483c)
function(build_mgba)
  set(LIBMGBA_ONLY ON)
  set(BUILD_LIBRETRO ON)
  set(BUILD_STATIC OFF)
  set(BUILD_SHARED OFF)
  set(SKIP_LIBRARY ON)
  set(DISABLE_FRONTENDS ON)
  set(DISABLE_DEPS ON)
  set(ENABLE_DEBUGGERS OFF)
  set(ENABLE_GDB_STUB OFF)
  set(ENABLE_SCRIPTING OFF)
  set(M_CORE_GBA ON)
  set(M_CORE_GB ON)
  add_subdirectory("${CMAKE_CURRENT_BINARY_DIR}/mgba-7a12d6d4b9acb14c0ae62c9166b6a2f3d08007f6" mgba-build EXCLUDE_FROM_ALL)
  set_target_properties(mgba_libretro PROPERTIES PREFIX "lib" OUTPUT_NAME "mgba")
endfunction()
build_mgba()
set(snes "${CMAKE_CURRENT_BINARY_DIR}/snes9x-204ea1c0b851f960cbf223075eb1c25641cb483c")
add_library(snes9x SHARED
  "${snes}/c4emu.c"
  "${snes}/msu1.c"
  "${snes}/zipfile.c"
  "${snes}/srtc.c"
  "${snes}/obc1.c"
  "${snes}/bsflash.c"
  "${snes}/tile.c"
  "${snes}/bsx.c"
  "${snes}/spc7110.c"
  "${snes}/fxemu.c"
  "${snes}/sdd1.c"
  "${snes}/seta.c"
  "${snes}/sa1hw.c"
  "${snes}/dsp.c"
  "${snes}/filter/snes_ntsc.c"
  "${snes}/apu/apu.cpp"
  "${snes}/apu/bapu/dsp/sdsp.cpp"
  "${snes}/apu/bapu/smp/smp.cpp"
  "${snes}/apu/bapu/smp/smp_state.cpp"
  "${snes}/cheats2.cpp"
  "${snes}/clip.cpp"
  "${snes}/controls.cpp"
  "${snes}/cpu.cpp"
  "${snes}/cpuexec.cpp"
  "${snes}/cpuops.cpp"
  "${snes}/crosshairs.cpp"
  "${snes}/dma.cpp"
  "${snes}/gfx.cpp"
  "${snes}/globals.cpp"
  "${snes}/loadzip.cpp"
  "${snes}/memmap.cpp"
  "${snes}/ppu.cpp"
  "${snes}/sa1.cpp"
  "${snes}/sa1cpu.cpp"
  "${snes}/snapshot.cpp"
  "${snes}/sha256.cpp"
  "${snes}/bml.cpp"
  "${snes}/fscompat.cpp"
  "${snes}/libretro/libretro.cpp"
  "${snes}/libretro/libretro-common/compat/compat_posix_string.c"
  "${snes}/libretro/libretro-common/compat/compat_strcasestr.c"
  "${snes}/libretro/libretro-common/compat/compat_snprintf.c"
  "${snes}/libretro/libretro-common/compat/compat_strl.c"
  "${snes}/libretro/libretro-common/compat/fopen_utf8.c"
  "${snes}/libretro/libretro-common/encodings/encoding_utf.c"
  "${snes}/libretro/libretro-common/encodings/encoding_crc32.c"
  "${snes}/libretro/libretro-common/encodings/encoding_deflate.c"
  "${snes}/libretro/libretro-common/features/features_cpu.c"
  "${snes}/libretro/libretro-common/file/file_path.c"
  "${snes}/libretro/libretro-common/file/file_path_io.c"
  "${snes}/libretro/libretro-common/streams/file_stream.c"
  "${snes}/libretro/libretro-common/streams/file_stream_transforms.c"
  "${snes}/libretro/libretro-common/string/rstrtod.c"
  "${snes}/libretro/libretro-common/string/stdstring.c"
  "${snes}/libretro/libretro-common/time/rtime.c"
  "${snes}/libretro/libretro-common/vfs/vfs_implementation.c"
  "${snes}/libretro/libretro-common/vfs/vfs_hybrid.c"
  "${snes}/libretro/libretro-common/file/retro_dirent.c"
)
target_include_directories(snes9x PRIVATE "${snes}" "${snes}/libretro" "${snes}/libretro/libretro-common/include" "${snes}/apu" "${snes}/apu/bapu")
target_compile_definitions(snes9x PRIVATE __LIBRETRO__ SKIP_STDIO_REDEFINES GIT_VERSION=" 204ea1c0")
target_compile_options(snes9x PRIVATE -O3 -fvisibility=hidden)
target_link_options(snes9x PRIVATE "-Wl,--version-script=${snes}/libretro/link.T")
target_link_libraries(snes9x PRIVATE m z)
