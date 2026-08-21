cmake_minimum_required(VERSION 3.22)
project(Ditune2 VERSION 0.1.0 LANGUAGES C CXX)

include(FetchContent)
FetchContent_Declare(JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 9.0.0)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(Ditune2
  COMPANY_NAME "DigiDAW"
  BUNDLE_ID "com.digidaw.ditune2"
  PLUGIN_MANUFACTURER_CODE DgDw
  PLUGIN_CODE DtN2
  FORMATS VST3 AU Standalone
  PRODUCT_NAME "Ditune2")

target_sources(Ditune2 PRIVATE
  Ditune2Engine.cpp
  PluginProcessor.cpp)

target_compile_features(Ditune2 PRIVATE cxx_std_17)
target_compile_definitions(Ditune2 PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_link_libraries(Ditune2 PRIVATE juce::juce_audio_utils juce::juce_dsp PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
