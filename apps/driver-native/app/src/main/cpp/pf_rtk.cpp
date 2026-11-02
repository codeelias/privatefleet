#include <jni.h>
#include <pthread.h>
#include <string.h>
#include <math.h>

#include "rtklib.h"

#define TAG "pf_rtk"

/* Android system codes must match the RTKLIB SYS_* bitmasks passed from Java. */
#define PF_SYS_GPS 1
#define PF_SYS_GLO 4
#define PF_SYS_GAL 8
#define PF_SYS_QZS 16
#define PF_SYS_CMP 32

static pthread_mutex_t g_mutex = PTHREAD_MUTEX_INITIALIZER;
static rtk_t g_rtk;
static int g_rtk_ready = 0;
static rtcm_t g_base;
static int g_base_ready = 0;
static obsd_t g_rover[MAXOBS];
static int g_rover_n = 0;
static long long g_epoch_ns = -1;
static double g_rb[3] = {0, 0, 0};
static int g_rb_set = 0;
static double g_last_stat = 0;
static double g_last_rr[3] = {0, 0, 0};
static double g_last_age = -1;
static double g_last_ratio = 0;

static int configure_rtk(void) {
    prcopt_t opt = prcopt_default;
    opt.mode = PMODE_KINEMA;
    opt.navsys = SYS_GPS | SYS_GLO | SYS_GAL | SYS_QZS | SYS_CMP;
    opt.nf = 2;
    opt.soltype = 0;
    opt.refpos = POSOPT_RTCM;
    opt.ionoopt = IONOOPT_IFLC;
    opt.tropopt = TROPOPT_SAAS;
    opt.sateph = EPHOPT_BRDC;
    opt.posopt[4] = 1;
    opt.elmin = 15.0 * D2R;
    rtkinit(&g_rtk, &opt);
    g_rtk.opt = opt;
    return 1;
}

static int code_for_frequency(int sys, double freq_hz) {
    (void) sys;
    if (freq_hz > 1585e6 && freq_hz < 1620e6) return CODE_L1C;      /* GLO L1 */
    if (freq_hz > 1570e6 && freq_hz < 1585e6) {
        return sys == SYS_GAL || sys == SYS_CMP ? CODE_L1X : CODE_L1C;
    }
    if (freq_hz > 1560e6 && freq_hz < 1570e6) return CODE_L2I;      /* BDS B1I */
    if (freq_hz > 1220e6 && freq_hz < 1235e6) return CODE_L2X;      /* GPS L2 */
    if (freq_hz > 1200e6 && freq_hz < 1210e6) return CODE_L2C;      /* GLO L2 */
    if (freq_hz > 1170e6 && freq_hz < 1182e6) return CODE_L5X;      /* L5/E5a */
    return CODE_NONE;
}

static void to_gtime(double seconds, gtime_t *out) {
    double sec = floor(seconds);
    out->time = (time_t) sec;
    out->sec = seconds - sec;
}

static int solve_epoch(void) {
    obsd_t combined[MAXOBS * 2];
    int n = 0;
    int i;

    if (!g_rtk_ready) return 0;

    for (i = 0; i < g_rover_n; i += 1) {
        combined[n] = g_rover[i];
        combined[n].rcv = 0;
        n += 1;
    }
    for (i = 0; i < g_base.obs.n; i += 1) {
        if (n >= MAXOBS * 2) break;
        combined[n] = g_base.obs.data[i];
        combined[n].rcv = 1;
        n += 1;
    }
    if (n < 8) return 0;

    if (g_rb_set) {
        memcpy(g_rtk.rb, g_rb, sizeof(g_rb));
    }
    int ret = rtkpos(&g_rtk, combined, n, &g_base.nav);
    g_last_stat = (double) g_rtk.sol.stat;
    g_last_age = g_rtk.sol.age;
    g_last_ratio = g_rtk.sol.ratio;
    memcpy(g_last_rr, g_rtk.sol.rr, sizeof(g_last_rr));
    return ret;
}

extern "C" JNIEXPORT void JNICALL
Java_com_privatefleet_driver_nativeapp_NativeRtkEngine_nativeInit(JNIEnv *, jobject) {
    pthread_mutex_lock(&g_mutex);
    if (!g_rtk_ready) {
        configure_rtk();
        g_rtk_ready = 1;
    }
    if (!g_base_ready) {
        init_rtcm(&g_base);
        g_base_ready = 1;
    }
    pthread_mutex_unlock(&g_mutex);
}

extern "C" JNIEXPORT void JNICALL
Java_com_privatefleet_driver_nativeapp_NativeRtkEngine_nativeAddMeasurement(
        JNIEnv *, jobject, jdouble gnssTimeSec, jint sys, jint prn,
        jdouble freqHz, jdouble cn0, jdouble pseudorange,
        jdouble pseudorangeRate, jdouble adrMeters, jint adrValid) {
    pthread_mutex_lock(&g_mutex);
    if (!g_rtk_ready || g_rover_n >= MAXOBS) {
        pthread_mutex_unlock(&g_mutex);
        return;
    }
    int sat = satno((int) sys, (int) prn);
    if (sat <= 0) {
        pthread_mutex_unlock(&g_mutex);
        return;
    }
    obsd_t *obs = &g_rover[g_rover_n];
    memset(obs, 0, sizeof(obsd_t));
    to_gtime(gnssTimeSec, &obs->time);
    obs->sat = (uint8_t) sat;
    obs->rcv = 0;
    obs->SNR[0] = (uint16_t) (cn0 * 1000.0);
    if (!adrValid) obs->LLI[0] |= 1;
    obs->code[0] = (uint8_t) code_for_frequency((int) sys, freqHz);
    double wavelength = CLIGHT / freqHz;
    obs->P[0] = pseudorange;
    obs->L[0] = adrValid ? adrMeters / wavelength : 0.0;
    obs->D[0] = (float) (-pseudorangeRate / wavelength);
    g_rover_n += 1;
    pthread_mutex_unlock(&g_mutex);
}

extern "C" JNIEXPORT void JNICALL
Java_com_privatefleet_driver_nativeapp_NativeRtkEngine_nativeStartEpoch(JNIEnv *, jobject) {
    pthread_mutex_lock(&g_mutex);
    g_rover_n = 0;
    g_epoch_ns = -1;
    pthread_mutex_unlock(&g_mutex);
}

extern "C" JNIEXPORT void JNICALL
Java_com_privatefleet_driver_nativeapp_NativeRtkEngine_nativeAddCorrections(
        JNIEnv *env, jobject, jbyteArray chunk) {
    if (!g_base_ready) return;
    jsize length = env->GetArrayLength(chunk);
    jbyte *bytes = env->GetByteArrayElements(chunk, NULL);
    if (bytes == NULL) return;
    pthread_mutex_lock(&g_mutex);
    for (jsize i = 0; i < length; i += 1) {
        input_rtcm3(&g_base, (uint8_t) bytes[i]);
        /* RTCM 1005/1006 sets the base station position once decoded. */
        if (!g_rb_set && g_base.sta.pos[0] != 0.0) {
            memcpy(g_rb, g_base.sta.pos, sizeof(g_rb));
            g_rb_set = 1;
        }
    }
    pthread_mutex_unlock(&g_mutex);
    env->ReleaseByteArrayElements(chunk, bytes, JNI_ABORT);
}

extern "C" JNIEXPORT jdoubleArray JNICALL
Java_com_privatefleet_driver_nativeapp_NativeRtkEngine_nativeSolve(JNIEnv *env, jobject) {
    double result[6] = {0, 0, 0, 0, -1, 0};
    pthread_mutex_lock(&g_mutex);
    solve_epoch();
    result[0] = g_last_stat;
    result[1] = g_last_rr[0];
    result[2] = g_last_rr[1];
    result[3] = g_last_rr[2];
    result[4] = g_last_age;
    result[5] = g_last_ratio;
    pthread_mutex_unlock(&g_mutex);

    jdoubleArray output = env->NewDoubleArray(6);
    if (output != NULL) {
        env->SetDoubleArrayRegion(output, 0, 6, result);
    }
    return output;
}
