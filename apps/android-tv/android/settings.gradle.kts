pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven("https://maven.mozilla.org/maven2/")
    }
}
rootProject.name = "GameEmulatorTV"
include(":app")
include(":emulator-native")
project(":emulator-native").projectDir = file("../../../packages/android-native/android")
