plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}
// Each host owns its outputs; do not share Kotlin/asset incremental caches across
// the Tauri and GeckoView Gradle roots (which use different Kotlin versions).
layout.buildDirectory.set(rootProject.layout.buildDirectory.dir("dependencies/emulator-native"))
android {
    namespace = "com.wandergame.emulator.nativecore"
    compileSdk = 36
    ndkVersion = "28.2.13676358"
    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
        externalNativeBuild { cmake { cppFlags += "-std=c++17" } }
    }
    externalNativeBuild { cmake {
        path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1"
        buildStagingDirectory = rootProject.layout.projectDirectory.dir(".cxx/emulator-native").asFile
    } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}
dependencies { implementation("androidx.webkit:webkit:1.14.0") }
