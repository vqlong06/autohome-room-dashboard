#pragma once

#include "secrets.h"

// Prefer LongOS names while accepting existing AutoHome secrets during migration.
#ifndef LONGOS_WIFI_SSID
#ifdef AUTOHOME_WIFI_SSID
#define LONGOS_WIFI_SSID AUTOHOME_WIFI_SSID
#else
#error "Define LONGOS_WIFI_SSID in include/secrets.h"
#endif
#endif

#ifndef LONGOS_WIFI_PASSWORD
#ifdef AUTOHOME_WIFI_PASSWORD
#define LONGOS_WIFI_PASSWORD AUTOHOME_WIFI_PASSWORD
#else
#error "Define LONGOS_WIFI_PASSWORD in include/secrets.h"
#endif
#endif

#ifndef LONGOS_AP_PASSWORD
#ifdef AUTOHOME_AP_PASSWORD
#define LONGOS_AP_PASSWORD AUTOHOME_AP_PASSWORD
#else
#error "Define LONGOS_AP_PASSWORD in include/secrets.h"
#endif
#endif

#ifndef LONGOS_SUPABASE_URL
#ifdef AUTOHOME_SUPABASE_URL
#define LONGOS_SUPABASE_URL AUTOHOME_SUPABASE_URL
#else
#error "Define LONGOS_SUPABASE_URL in include/secrets.h"
#endif
#endif

#ifndef LONGOS_SUPABASE_PUBLISHABLE_KEY
#ifdef AUTOHOME_SUPABASE_PUBLISHABLE_KEY
#define LONGOS_SUPABASE_PUBLISHABLE_KEY AUTOHOME_SUPABASE_PUBLISHABLE_KEY
#else
#error "Define LONGOS_SUPABASE_PUBLISHABLE_KEY in include/secrets.h"
#endif
#endif

#ifndef LONGOS_SUPABASE_ROOM_ID
#ifdef AUTOHOME_SUPABASE_ROOM_ID
#define LONGOS_SUPABASE_ROOM_ID AUTOHOME_SUPABASE_ROOM_ID
#else
#error "Define LONGOS_SUPABASE_ROOM_ID in include/secrets.h"
#endif
#endif

#ifndef LONGOS_SUPABASE_DEVICE_TOKEN
#ifdef AUTOHOME_SUPABASE_DEVICE_TOKEN
#define LONGOS_SUPABASE_DEVICE_TOKEN AUTOHOME_SUPABASE_DEVICE_TOKEN
#else
#error "Define LONGOS_SUPABASE_DEVICE_TOKEN in include/secrets.h"
#endif
#endif
