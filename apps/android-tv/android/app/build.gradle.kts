import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val repoRoot = rootDir.resolve("../../..")
val appVersion = (JsonSlurper().parse(repoRoot.resolve("package.json")) as Map<*, *>)["version"] as String
val versionParts = appVersion.split('.').map(String::toInt)
val signingFile = repoRoot.resolve("secrets/keystore.properties")
val signingProperties = Properties().apply {
    if (signingFile.exists()) signingFile.inputStream().use { load(it) }
}
fun signingValue(key: String, env: String) = signingProperties.getProperty(key)?.takeIf { it.isNotBlank() }
    ?: System.getenv(env)?.takeIf { it.isNotBlank() }

android {
    namespace = "com.wandergame.gameemulator.tv"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.wandergame.gameemulator.tv"
        minSdk = 26
        targetSdk = 36
        versionName = appVersion
        versionCode = versionParts[0] * 1_000_000 + versionParts[1] * 1_000 + versionParts[2]
        ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a") }
    }
    signingConfigs {
        create("release") {
            val path = signingValue("storeFile", "ANDROID_KEYSTORE_PATH")
            if (path != null) {
                storeFile = if (signingProperties.getProperty("storeFile").isNullOrBlank()) file(path)
                    else signingFile.parentFile.resolve(path)
                storePassword = signingValue("storePassword", "ANDROID_KEYSTORE_PASSWORD")
                keyAlias = signingValue("keyAlias", "ANDROID_KEY_ALIAS")
                keyPassword = signingValue("keyPassword", "ANDROID_KEY_PASSWORD")
            }
        }
    }
    buildTypes {
        getByName("debug") { applicationIdSuffix = ".debug"; versionNameSuffix = "-debug" }
        getByName("release") {
            if (signingConfigs.getByName("release").storeFile != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { buildConfig = true }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/frontend"))
    sourceSets["main"].res.srcDir(layout.buildDirectory.dir("generated/artwork"))
    androidResources { noCompress += listOf("wasm") }
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

// Gradle also refuses to package an absent frontend when invoked directly.
val verifyFrontend by tasks.registering {
    doLast {
        check(listOf("index", "nes", "arcade").all { rootDir.resolve("../dist/$it.html").isFile }) {
            "Run pnpm build:android-tv:frontend first."
        }
    }
}
val syncFrontend by tasks.registering(Sync::class) {
    dependsOn(verifyFrontend)
    val dist = rootDir.resolve("../dist")
    from(dist)
    into(layout.buildDirectory.dir("generated/frontend/www"))
}
val syncArtwork by tasks.registering(Copy::class) {
    from(repoRoot.resolve("apps/icon/icon.png"))
    into(layout.buildDirectory.dir("generated/artwork/drawable"))
    rename { "app_icon.png" }
}
tasks.named("preBuild") { dependsOn(syncFrontend, syncArtwork) }

dependencies {
    implementation("org.mozilla.geckoview:geckoview:149.0.20260403140140")
    implementation("androidx.activity:activity-ktx:1.10.1")
    testImplementation("junit:junit:4.13.2")
}
