cmake_minimum_required(VERSION 3.22)
project(pf_rtk C)

set(CMAKE_C_STANDARD 99)

set(RTKLIB_DIR ${CMAKE_CURRENT_SOURCE_DIR}/rtklib)

add_library(pf_rtk SHARED
    pf_rtk.cpp
    ${RTKLIB_DIR}/rtkcmn.c
    ${RTKLIB_DIR}/rtkpos.c
    ${RTKLIB_DIR}/pntpos.c
    ${RTKLIB_DIR}/ppp.c
    ${RTKLIB_DIR}/ppp_ar.c
    ${RTKLIB_DIR}/ephemeris.c
    ${RTKLIB_DIR}/preceph.c
    ${RTKLIB_DIR}/rtcm.c
    ${RTKLIB_DIR}/rtcm2.c
    ${RTKLIB_DIR}/rtcm3.c
    ${RTKLIB_DIR}/rtcm3e.c
    ${RTKLIB_DIR}/lambda.c
    ${RTKLIB_DIR}/geoid.c
    ${RTKLIB_DIR}/datum.c
    ${RTKLIB_DIR}/sbas.c
    ${RTKLIB_DIR}/ionex.c
    ${RTKLIB_DIR}/tides.c
    ${RTKLIB_DIR}/solution.c
)

target_include_directories(pf_rtk PRIVATE ${RTKLIB_DIR})
target_compile_options(pf_rtk PRIVATE -O2 -fvisibility=hidden -DENAGLO -DENAGAL -DENAQZS -DENACMP)
target_link_libraries(pf_rtk android log m)

set_property(TARGET pf_rtk PROPERTY CXX_STANDARD 17)
