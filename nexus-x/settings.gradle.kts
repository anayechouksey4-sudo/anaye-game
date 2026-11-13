pluginManagement {
    repositories {
        // Google's Cloud Storage mirror of Maven Central avoids repo.maven.apache.org rate limits.
        maven("https://maven-central.storage-download.googleapis.com/maven2")
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        gradlePluginPortal()
        mavenCentral()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven("https://maven-central.storage-download.googleapis.com/maven2")
        google()
        mavenCentral()
    }
}

rootProject.name = "NexusX"
include(":core")
include(":controller")
include(":companion")
