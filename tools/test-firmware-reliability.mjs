import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const firmware = await readFile(resolve(root, 'src/main.cpp'), 'utf8');

function stripComments(source) {
  let output = '';
  let state = 'code';
  let quote = '';

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      if (char === '\n') {
        output += '\n';
        state = 'code';
      } else {
        output += ' ';
      }
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        output += '  ';
        state = 'code';
        index += 1;
      } else {
        output += char === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'string') {
      output += char;
      if (char === '\\') {
        output += next || '';
        index += 1;
      } else if (char === quote) {
        state = 'code';
      }
      continue;
    }
    if (char === '/' && next === '/') {
      output += '  ';
      state = 'line-comment';
      index += 1;
    } else if (char === '/' && next === '*') {
      output += '  ';
      state = 'block-comment';
      index += 1;
    } else {
      output += char;
      if (char === '"' || char === "'") {
        state = 'string';
        quote = char;
      }
    }
  }
  return output;
}

function functionBody(source, name) {
  const signature = new RegExp(`\\b(?:void|bool|int|uint32_t|uint64_t|float|String)\\s+${name}\\s*\\([^)]*\\)\\s*\\{`, 'm');
  const match = signature.exec(source);
  assert.ok(match, `Missing firmware function: ${name}`);

  const openingBrace = source.indexOf('{', match.index);
  let depth = 0;
  let state = 'code';
  let quote = '';

  for (let index = openingBrace; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (state === 'line-comment') {
      if (char === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 1;
      }
      continue;
    }
    if (state === 'string') {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        state = 'code';
      }
      continue;
    }
    if (char === '/' && next === '/') {
      state = 'line-comment';
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      state = 'string';
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, index);
    }
  }

  assert.fail(`Unterminated firmware function: ${name}`);
}

function unsignedConstant(source, name) {
  const match = new RegExp(`const unsigned long ${name}\\s*=\\s*([^;]+);`).exec(source);
  assert.ok(match, `Missing unsigned long constant: ${name}`);
  const expression = match[1].replace(/UL|LU|U|L/g, '');
  assert.match(expression, /^[\d\s+*/()-]+$/, `${name} must remain a numeric constant`);
  const value = Function(`"use strict"; return (${expression});`)();
  assert.ok(Number.isSafeInteger(value) && value > 0, `${name} must be a positive integer`);
  return value;
}

function validateFirmware(source) {
  const code = stripComments(source);
  const sampleInterval = unsignedConstant(code, 'SAMPLE_INTERVAL_MS');
  const cloudInterval = unsignedConstant(code, 'CLOUD_HISTORY_INTERVAL_MS');
  const cloudRetry = unsignedConstant(code, 'CLOUD_HISTORY_RETRY_INTERVAL_MS');
  const cloudRetryMax = unsignedConstant(code, 'CLOUD_HISTORY_RETRY_MAX_MS');
  const saveInterval = unsignedConstant(code, 'HISTORY_SAVE_INTERVAL_MS');
  const saveRetry = unsignedConstant(code, 'HISTORY_SAVE_RETRY_INTERVAL_MS');
  const saveRetryMax = unsignedConstant(code, 'HISTORY_SAVE_RETRY_MAX_MS');

  assert.equal(sampleInterval, 1000, 'The retention evidence fresh-sample bound requires a 1-second sample cadence');
  assert.equal(cloudInterval, 600_000, 'Cloud history cadence must remain 10 minutes');
  assert.equal(cloudRetry, 30_000, 'Cloud history safe retry must start at 30 seconds');
  assert.equal(cloudRetryMax, 300_000, 'Cloud history safe retry must cap at 5 minutes');
  assert.equal(saveInterval, 900_000, 'NVS save cadence must remain 15 minutes');
  assert.equal(saveRetry, 30_000, 'NVS retry must start at 30 seconds');
  assert.equal(saveRetryMax, 300_000, 'NVS retry must cap at 5 minutes');
  assert.match(code, /const char \*LEGACY_HISTORY_NAMESPACE = "autohome";/, 'Legacy NVS namespace must remain autohome');
  assert.equal((code.match(/\bLEGACY_HISTORY_NAMESPACE\b/g) || []).length, 2, 'Legacy NVS namespace must only be declared and opened');
  assert.match(code, /const int HISTORY_DAYS = 21;/, 'NVS history ring must remain 21 days');
  assert.match(
    code,
    /struct DayStat\s*\{\s*uint32_t day = 0;\s*double tempSum = 0;\s*double humiditySum = 0;\s*uint32_t samples = 0;\s*float tempMin = NAN;\s*float tempMax = NAN;\s*float humidityMin = NAN;\s*float humidityMax = NAN;\s*\};/,
    'Persisted DayStat field types and order must remain binary-compatible'
  );
  assert.match(code, /DayStat history\[HISTORY_DAYS\];/, 'The persisted history array must use the locked 21-day DayStat layout');
  assert.doesNotMatch(code, /#\s*pragma\s+pack\b|\b__attribute__\s*\(\(\s*packed\s*\)\)/, 'Persisted history layout must not be packed');
  assert.doesNotMatch(
    code,
    /\bpreferences\.(?:clear|remove)\s*\(|\b(?:nvs_flash_erase|nvs_erase_all|nvs_erase_key|esp_partition_erase_range)\s*\(/,
    'Firmware must not erase retained NVS history'
  );
  const loadHistory = functionBody(code, 'loadHistory');
  assert.match(loadHistory, /historyReady = preferences\.begin\(LEGACY_HISTORY_NAMESPACE, false\);/);
  assert.match(loadHistory, /size_t bytesRead = preferences\.getBytes\("daily", history, sizeof\(history\)\);/);
  assert.match(loadHistory, /if \(bytesRead != sizeof\(history\)\)/);
  assert.equal((code.match(/preferences\.getBytes\s*\(/g) || []).length, 1, 'History must be loaded from NVS exactly once');
  assert.match(code, /#include "longos_retry_policy\.h"/);
  assert.match(code, /longos::PeriodicRetryTimer cloudHistoryRetryTimer;/);
  assert.match(code, /longos::PeriodicRetryTimer historySaveRetryTimer;/);
  assert.doesNotMatch(code, /\blastCloudHistoryMs\b/, 'The failed-attempt 10-minute timer must not return');

  const uploadHistory = functionBody(code, 'uploadHistoryToSupabase');
  assert.doesNotMatch(
    uploadHistory,
    /\bforce\s*(?:=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=)/,
    'The force argument must not be overridden'
  );
  assert.doesNotMatch(uploadHistory, /^\s*#\s*(?:if|ifdef|ifndef)\b/m, 'The history scheduler must not be conditionally compiled out');
  assert.doesNotMatch(
    uploadHistory,
    /cloudHistoryRetryTimer\.(?:initialized|referenceMs|consecutiveFailures)\b/,
    'Firmware must use the retry timer API instead of mutating its state'
  );
  assert.match(
    uploadHistory,
    /if\s*\(\s*!cloudHistoryRetryTimer\.due\(\s*now,\s*force,\s*CLOUD_HISTORY_INTERVAL_MS,\s*CLOUD_HISTORY_RETRY_INTERVAL_MS,\s*CLOUD_HISTORY_RETRY_MAX_MS\s*\)\s*\)\s*\{\s*return;\s*\}/,
    'The history retry policy must guard the POST with an immediate return'
  );
  assert.match(
    uploadHistory,
    /if\s*\(!https\.begin\(client, endpoint\)\)\s*\{[\s\S]*?cloudHistoryRetryTimer\.recordResult\(millis\(\), false\);[\s\S]*?return;/,
    'HTTPS begin failures must enter retry backoff'
  );
  assert.equal(
    (uploadHistory.match(/cloudHistoryRetryTimer\.recordResult\(millis\(\), false\);/g) || []).length,
    1,
    'Only a pre-request HTTPS begin failure may use fast retry'
  );
  assert.match(uploadHistory, /lastCloudHistoryOk = code >= 200 && code < 300;/);
  assert.equal((uploadHistory.match(/https\.POST\s*\(/g) || []).length, 1, 'Each scheduled history attempt must make exactly one POST');
  assert.ok(
    uploadHistory.indexOf('cloudHistoryRetryTimer.due(') < uploadHistory.indexOf('https.POST('),
    'The history scheduler guard must run before the POST'
  );
  assert.match(
    uploadHistory,
    /if \(lastCloudHistoryOk\)\s*\{\s*cloudHistoryRetryTimer\.recordResult\(millis\(\), true\);\s*\}\s*else\s*\{[\s\S]*?cloudHistoryRetryTimer\.defer\(millis\(\)\);\s*\}/,
    'An ambiguous POST failure must preserve normal cadence instead of retrying quickly'
  );

  const maintainNetwork = functionBody(code, 'maintainNetwork');
  assert.doesNotMatch(maintainNetwork, /cloudHistoryRetryTimer|uploadHistoryToSupabase\s*\(\s*true\s*\)/, 'Wi-Fi reconnect must preserve history cadence');
  assert.match(maintainNetwork, /uploadLatestToSupabase\s*\(\s*true\s*\)/, 'Wi-Fi reconnect must restore the latest heartbeat immediately');

  const loop = functionBody(code, 'loop');
  assert.ok(loop.indexOf('maintainNetwork();') < loop.indexOf('uploadHistoryToSupabase();'), 'Network maintenance must run before the scheduled history upload');
  assert.equal((loop.match(/uploadHistoryToSupabase\s*\(\s*\)/g) || []).length, 1, 'The main loop must make one scheduled history call');
  assert.doesNotMatch(loop, /uploadHistoryToSupabase\s*\(\s*true\s*\)/);
  const setup = functionBody(code, 'setup');
  assert.equal((setup.match(/uploadHistoryToSupabase\s*\(\s*true\s*\)/g) || []).length, 1, 'Setup must make one initial history call');
  assert.equal((code.match(/\buploadHistoryToSupabase\s*\(/g) || []).length, 3, 'History upload may only be defined once and called from setup/loop');

  assert.equal(
    (code.match(/\btimeReady\s*=\s*false\s*;/g) || []).length,
    1,
    'timeReady may start false but must not be cleared merely because Wi-Fi disconnects'
  );
  const refreshTime = functionBody(code, 'refreshTimeStatus');
  assert.doesNotMatch(refreshTime, /stationConnected\s*\(/, 'Clock validity must not depend on current Wi-Fi state');
  assert.match(refreshTime, /currentLocalDay\(\) > 0/);
  assert.match(refreshTime, /timeReady\s*=\s*true\s*;/);
  assert.doesNotMatch(maintainNetwork, /\btimeReady\s*=/);
  const recordHistory = functionBody(code, 'recordHistory');
  assert.match(recordHistory, /!timeReady/);
  assert.match(recordHistory, /uint32_t day = currentLocalDay\(\);[\s\S]*?if \(day == 0\)/);

  const saveHistory = functionBody(code, 'saveHistory');
  assert.doesNotMatch(saveHistory, /^\s*#\s*(?:if|ifdef|ifndef)\b/m, 'The NVS scheduler must not be conditionally compiled out');
  assert.match(
    saveHistory,
    /if\s*\(\s*!historySaveRetryTimer\.due\(\s*now,\s*force,\s*HISTORY_SAVE_INTERVAL_MS,\s*HISTORY_SAVE_RETRY_INTERVAL_MS,\s*HISTORY_SAVE_RETRY_MAX_MS\s*\)\s*\)\s*\{\s*return;\s*\}/,
    'The NVS retry policy must guard the write with an immediate return'
  );
  assert.match(saveHistory, /size_t bytesWritten = preferences\.putBytes\("daily", history, sizeof\(history\)\);/);
  assert.equal((saveHistory.match(/preferences\.putBytes\s*\(/g) || []).length, 1, 'Each save attempt must write NVS exactly once');
  assert.match(
    saveHistory,
    /if \(bytesWritten != sizeof\(history\)\)\s*\{[\s\S]*?historySaveRetryTimer\.recordResult\(millis\(\), false\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?historySaveRetryTimer\.recordResult\(millis\(\), true\);[\s\S]*?historyDirty = false;/,
    'A short NVS write must retain dirty history and enter retry backoff'
  );
  assert.equal(
    (saveHistory.match(/\bhistoryDirty\s*(?:=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=)/g) || []).length,
    1,
    'Only one successful full NVS write may clear dirty history'
  );

  const serialSecret = /Serial\.(?:print|println|printf)\s*\([^;]*(?:AP_PASSWORD|WIFI_PASSWORD|SUPABASE_PUBLISHABLE_KEY|SUPABASE_DEVICE_TOKEN)[^;]*\);/s;
  assert.doesNotMatch(code, serialSecret, 'Firmware must never print configured secrets');
  const startAccessPoint = functionBody(code, 'startAccessPoint');
  assert.doesNotMatch(startAccessPoint, /Password:/i, 'Fallback AP logs must not advertise a password value');
  assert.equal((startAccessPoint.match(/\bAP_PASSWORD\b/g) || []).length, 1, 'AP password must only be passed to WiFi.softAP');
  assert.match(startAccessPoint, /WiFi\.softAP\(AP_SSID, AP_PASSWORD\)/);
  assert.equal((code.match(/\bAP_PASSWORD\b/g) || []).length, 2, 'AP password must not be copied or aliased');
  assert.equal((code.match(/\bLONGOS_AP_PASSWORD\b/g) || []).length, 1, 'AP password macro must only initialize its private variable');
  assert.equal((code.match(/\bWIFI_PASSWORD\b/g) || []).length, 4, 'Wi-Fi password must not be copied or aliased');
  assert.equal((code.match(/\bLONGOS_WIFI_PASSWORD\b/g) || []).length, 1, 'Wi-Fi password macro must only initialize its private variable');
  assert.equal((code.match(/WiFi\.begin\(WIFI_SSID, WIFI_PASSWORD\)/g) || []).length, 3);
  assert.equal((code.match(/\bSUPABASE_PUBLISHABLE_KEY\b/g) || []).length, 4, 'Publishable key must only be checked and sent as an API header');
  assert.equal((code.match(/\bLONGOS_SUPABASE_PUBLISHABLE_KEY\b/g) || []).length, 1, 'Publishable key macro must only initialize its private variable');
  assert.equal((code.match(/https\.addHeader\("apikey", SUPABASE_PUBLISHABLE_KEY\);/g) || []).length, 2);
  assert.equal((code.match(/\bSUPABASE_DEVICE_TOKEN\b/g) || []).length, 3, 'Device token must only be sent as an API header');
  assert.equal((code.match(/\bLONGOS_SUPABASE_DEVICE_TOKEN\b/g) || []).length, 1, 'Device token macro must only initialize its private variable');
  assert.equal((code.match(/https\.addHeader\("x-device-token", SUPABASE_DEVICE_TOKEN\);/g) || []).length, 2);
}

function expectMutationRejected(name, mutate) {
  const mutated = mutate(firmware);
  assert.notEqual(mutated, firmware, `Mutation did not change firmware: ${name}`);
  assert.throws(() => validateFirmware(mutated), undefined, `Mutation escaped the reliability gate: ${name}`);
}

validateFirmware(firmware);

expectMutationRejected('sensor sample cadence invalidates the fresh-boot evidence bound', (source) => source.replace(
  'const unsigned long SAMPLE_INTERVAL_MS = 1000;',
  'const unsigned long SAMPLE_INTERVAL_MS = 100;'
));
expectMutationRejected('legacy NVS namespace changes', (source) => source.replace(
  'LEGACY_HISTORY_NAMESPACE = "autohome"',
  'LEGACY_HISTORY_NAMESPACE = "longos"'
));
expectMutationRejected('history retention count changes', (source) => source.replace(
  'const int HISTORY_DAYS = 21;',
  'const int HISTORY_DAYS = 20;'
));
expectMutationRejected('persisted history array bypasses the locked retention count', (source) => source.replace(
  'DayStat history[HISTORY_DAYS];',
  'DayStat history[20];'
));
expectMutationRejected('persisted DayStat layout changes', (source) => source.replace(
  '  double tempSum = 0;\n  double humiditySum = 0;',
  '  double humiditySum = 0;\n  double tempSum = 0;'
));
expectMutationRejected('persisted DayStat layout is packed', (source) => source.replace(
  'struct DayStat {',
  '#pragma pack(push, 1)\nstruct DayStat {'
));
expectMutationRejected('retained NVS history is explicitly erased', (source) => source.replace(
  '  historyReady = preferences.begin(LEGACY_HISTORY_NAMESPACE, false);',
  '  historyReady = preferences.begin(LEGACY_HISTORY_NAMESPACE, false);\n  preferences.clear();'
));
expectMutationRejected('legacy NVS read key changes', (source) => source.replace(
  'preferences.getBytes("daily", history, sizeof(history))',
  'preferences.getBytes("history", history, sizeof(history))'
));
expectMutationRejected('legacy NVS read size changes', (source) => source.replace(
  'preferences.getBytes("daily", history, sizeof(history))',
  'preferences.getBytes("daily", history, sizeof(history) - 1)'
));
expectMutationRejected('legacy NVS write key changes', (source) => source.replace(
  'preferences.putBytes("daily", history, sizeof(history))',
  'preferences.putBytes("history", history, sizeof(history))'
));
expectMutationRejected('legacy NVS write size changes', (source) => source.replace(
  'preferences.putBytes("daily", history, sizeof(history))',
  'preferences.putBytes("daily", history, sizeof(history) - 1)'
));

expectMutationRejected('pre-request setup failure loses short retry', (source) => source.replace(
  'CLOUD_HISTORY_RETRY_INTERVAL_MS = 30UL * 1000UL',
  'CLOUD_HISTORY_RETRY_INTERVAL_MS = 10UL * 60UL * 1000UL'
));
expectMutationRejected('reconnect resets history cadence', (source) => source.replace(
  '      setupMdns();\n      lastCloudUploadMs = 0;',
  '      setupMdns();\n      cloudHistoryRetryTimer.defer(millis());\n      lastCloudUploadMs = 0;'
));
expectMutationRejected('disconnect clears synchronized clock', (source) => source.replace(
  '  stationWasConnected = false;\n  timeSyncConfigured = false;',
  '  stationWasConnected = false;\n  timeReady = false;\n  timeSyncConfigured = false;'
));
expectMutationRejected('short NVS write is accepted', (source) => source.replace(
  'if (bytesWritten != sizeof(history))',
  'if (bytesWritten == sizeof(history))'
));
expectMutationRejected('AP password is printed', (source) => source.replace(
  '  Serial.println(AP_SSID);',
  '  Serial.println(AP_SSID);\n  Serial.println(AP_PASSWORD);'
));
expectMutationRejected('HTTPS begin failure is marked healthy', (source) => source.replace(
  '    cloudHistoryRetryTimer.recordResult(millis(), false);',
  '    cloudHistoryRetryTimer.recordResult(millis(), true);'
));
expectMutationRejected('history scheduler guard is bypassed', (source) => source.replace(
  'if (!cloudHistoryRetryTimer.due(',
  'if (false && !cloudHistoryRetryTimer.due('
));
expectMutationRejected('short NVS write clears dirty state', (source) => source.replace(
  '    historySaveRetryTimer.recordResult(millis(), false);',
  '    historySaveRetryTimer.recordResult(millis(), false);\n    historyDirty = false;'
));
expectMutationRejected('ambiguous POST failure retries quickly', (source) => source.replace(
  '    cloudHistoryRetryTimer.defer(millis());',
  '    cloudHistoryRetryTimer.recordResult(millis(), false);'
));
expectMutationRejected('AP password is leaked through an alias', (source) => source
  .replace(
    'const char *AP_PASSWORD = LONGOS_AP_PASSWORD;',
    'const char *AP_PASSWORD = LONGOS_AP_PASSWORD;\nconst char *LEAKED_AP_SECRET = AP_PASSWORD;'
  )
  .replace(
    '  Serial.println(AP_SSID);',
    '  Serial.println(AP_SSID);\n  Serial.println(LEAKED_AP_SECRET);'
  ));
expectMutationRejected('force argument bypasses history scheduler', (source) => source.replace(
  '  unsigned long now = millis();\n  if (!cloudHistoryRetryTimer.due(',
  '  unsigned long now = millis();\n  force = true;\n  if (!cloudHistoryRetryTimer.due('
));
expectMutationRejected('loop adds a forced history upload', (source) => source.replace(
  '  uploadHistoryToSupabase();\n  saveHistory();',
  '  uploadHistoryToSupabase();\n  uploadHistoryToSupabase(true);\n  saveHistory();'
));
expectMutationRejected('short NVS write clears dirty with zero', (source) => source.replace(
  '    historySaveRetryTimer.recordResult(millis(), false);',
  '    historySaveRetryTimer.recordResult(millis(), false);\n    historyDirty = 0;'
));
expectMutationRejected('extra NVS write bypasses scheduler', (source) => source.replace(
  '  size_t bytesWritten = preferences.putBytes("daily", history, sizeof(history));',
  '  preferences.putBytes("daily", history, sizeof(history));\n  size_t bytesWritten = preferences.putBytes("daily", history, sizeof(history));'
));
expectMutationRejected('AP password macro is leaked through an alias', (source) => source
  .replace(
    'const char *AP_PASSWORD = LONGOS_AP_PASSWORD;',
    'const char *AP_PASSWORD = LONGOS_AP_PASSWORD;\nconst char *LEAKED_AP_MACRO = LONGOS_AP_PASSWORD;'
  )
  .replace(
    '  Serial.println(AP_SSID);',
    '  Serial.println(AP_SSID);\n  Serial.println(LEAKED_AP_MACRO);'
  ));
expectMutationRejected('device token macro is leaked through an alias', (source) => source
  .replace(
    'const char *SUPABASE_DEVICE_TOKEN = LONGOS_SUPABASE_DEVICE_TOKEN;',
    'const char *SUPABASE_DEVICE_TOKEN = LONGOS_SUPABASE_DEVICE_TOKEN;\nconst char *LEAKED_DEVICE_TOKEN = LONGOS_SUPABASE_DEVICE_TOKEN;'
  )
  .replace(
    '  Serial.println(AP_SSID);',
    '  Serial.println(AP_SSID);\n  Serial.println(LEAKED_DEVICE_TOKEN);'
  ));
expectMutationRejected('cloud scheduler guard is commented out', (source) => source.replace(
  `  if (!cloudHistoryRetryTimer.due(
        now,
        force,
        CLOUD_HISTORY_INTERVAL_MS,
        CLOUD_HISTORY_RETRY_INTERVAL_MS,
        CLOUD_HISTORY_RETRY_MAX_MS
      )) {
    return;
  }`,
  `  /* if (!cloudHistoryRetryTimer.due(
        now,
        force,
        CLOUD_HISTORY_INTERVAL_MS,
        CLOUD_HISTORY_RETRY_INTERVAL_MS,
        CLOUD_HISTORY_RETRY_MAX_MS
      )) {
    return;
  } */`
));
expectMutationRejected('NVS scheduler guard is commented out', (source) => source.replace(
  `  if (!historySaveRetryTimer.due(
        now,
        force,
        HISTORY_SAVE_INTERVAL_MS,
        HISTORY_SAVE_RETRY_INTERVAL_MS,
        HISTORY_SAVE_RETRY_MAX_MS
      )) {
    return;
  }`,
  `  /* if (!historySaveRetryTimer.due(
        now,
        force,
        HISTORY_SAVE_INTERVAL_MS,
        HISTORY_SAVE_RETRY_INTERVAL_MS,
        HISTORY_SAVE_RETRY_MAX_MS
      )) {
    return;
  } */`
));
expectMutationRejected('history attempt sends a duplicate POST', (source) => source.replace(
  '  int code = https.POST(buildHistoryPayload());',
  '  https.POST(buildHistoryPayload());\n  int code = https.POST(buildHistoryPayload());'
));
expectMutationRejected('compound force assignment bypasses history scheduler', (source) => source.replace(
  '  unsigned long now = millis();\n  if (!cloudHistoryRetryTimer.due(',
  '  unsigned long now = millis();\n  force |= true;\n  if (!cloudHistoryRetryTimer.due('
));
expectMutationRejected('timer state is reset before history guard', (source) => source.replace(
  '  unsigned long now = millis();\n  if (!cloudHistoryRetryTimer.due(',
  '  unsigned long now = millis();\n  cloudHistoryRetryTimer.initialized = false;\n  if (!cloudHistoryRetryTimer.due('
));
expectMutationRejected('cloud scheduler guard is disabled by preprocessor', (source) => source.replace(
  '  if (!cloudHistoryRetryTimer.due(',
  '  #if 0\n  if (!cloudHistoryRetryTimer.due('
).replace(
  '  WiFiClientSecure client;',
  '  #endif\n\n  WiFiClientSecure client;'
));
expectMutationRejected('NVS scheduler guard is disabled by preprocessor', (source) => source.replace(
  '  if (!historySaveRetryTimer.due(',
  '  #if 0\n  if (!historySaveRetryTimer.due('
).replace(
  '  size_t bytesWritten = preferences.putBytes',
  '  #endif\n\n  size_t bytesWritten = preferences.putBytes'
));

console.log('LongOS firmware reliability tests: OK (34 mutations rejected)');
