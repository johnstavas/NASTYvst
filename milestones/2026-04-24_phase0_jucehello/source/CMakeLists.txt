# Phase-0 toolchain smoke test.
# Validates: CMake + MSVC + JUCE 8 FetchContent + VST3 emit on this machine.
# Throwaway — delete `.phase0-juce-test/` after the .vst3 loads in Reaper.

cmake_minimum_required(VERSION 3.22)
project(JuceHello VERSION 0.1.0)

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

juce_add_plugin(JuceHello
    PRODUCT_NAME              "JuceHello"
    COMPANY_NAME              "Shags"
    BUNDLE_ID                 com.shags.jucehello
    PLUGIN_MANUFACTURER_CODE  Shgs
    PLUGIN_CODE               Helo
    FORMATS                   VST3
    IS_SYNTH                  FALSE
    NEEDS_MIDI_INPUT          FALSE
    NEEDS_MIDI_OUTPUT         FALSE
    COPY_PLUGIN_AFTER_BUILD   FALSE
)

juce_generate_juce_header(JuceHello)

target_sources(JuceHello PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
)

target_compile_definitions(JuceHello PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
)

target_link_libraries(JuceHello PRIVATE
    juce::juce_audio_utils
    juce::juce_audio_processors
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags
)
