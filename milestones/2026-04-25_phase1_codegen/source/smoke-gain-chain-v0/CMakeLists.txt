cmake_minimum_required(VERSION 3.22)
project(SmokeGainChainV0 VERSION 0.1.0)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.4
    GIT_SHALLOW    TRUE
)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(SmokeGainChainV0
    PRODUCT_NAME              "SmokeGainChainV0"
    COMPANY_NAME              "Shags"
    BUNDLE_ID                 "com.shags.smokegainchainv0"
    PLUGIN_MANUFACTURER_CODE  Shgs
    PLUGIN_CODE               SGCV
    FORMATS                   VST3
    IS_SYNTH                  FALSE
    NEEDS_MIDI_INPUT          FALSE
    NEEDS_MIDI_OUTPUT         FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD   FALSE
)

target_sources(SmokeGainChainV0 PRIVATE
    src/PluginProcessor.cpp
    src/PluginEditor.cpp
    src/MasterGraph.cpp
)

target_include_directories(SmokeGainChainV0 PRIVATE
    src
    src/ops
)

target_compile_definitions(SmokeGainChainV0 PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
)

target_link_libraries(SmokeGainChainV0 PRIVATE
    juce::juce_audio_utils
    juce::juce_audio_processors
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags
)
