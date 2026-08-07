# Data model LongOS Health M1

## `health_metric_buckets`

Bucket Steps đã tổng hợp bởi HealthKit.

Khóa idempotent:

```text
(user_id, metric_key, bucket_start, bucket_end, algorithm_version)
```

Các trường quan trọng:

- `user_id`: chủ sở hữu từ Supabase Auth.
- `metric_key`: chỉ `steps` trong M1.
- `bucket_start`, `bucket_end`: timestamp UTC.
- `local_date`, `timezone_id`, `utc_offset_minutes`: ngữ cảnh lịch địa phương.
- `value_integer`: số bước không âm.
- `unit`: `count`.
- `provenance`: `healthkit_statistics`.
- `source_updated_at`: lần app quan sát thống kê này.

Chỉ owner được SELECT qua RLS. Không có policy write cho app.

## `health_sync_status`

Khóa:

```text
(user_id, installation_id, metric_key)
```

Cho biết request và source timestamp mới nhất đã được backend chấp nhận. Bảng này không thay thế hàng đợi local.

## `longos_health_private.health_ingest_batches`

Ledger private cho request idempotency:

```text
(user_id, request_id)
```

Lưu SHA-256 của canonical payload và ACK. Cùng request ID/cùng hash trả lại ACK cũ. Cùng request ID/hash khác bị từ chối `409`.

## Hợp đồng ingest

```json
{
  "schemaVersion": 1,
  "requestId": "UUID",
  "installationId": "UUID",
  "buckets": [{
    "metric": "steps",
    "start": "2026-08-07T00:00:00Z",
    "end": "2026-08-07T01:00:00Z",
    "localDate": "2026-08-07",
    "timezoneId": "Asia/Ho_Chi_Minh",
    "utcOffsetMinutes": 420,
    "value": 312,
    "unit": "count",
    "algorithmVersion": 1,
    "sourceUpdatedAt": "2026-08-07T01:05:00Z"
  }]
}
```

Giới hạn: tối đa 500 bucket/256 KiB; chỉ metric/unit/version allowlist; integer không âm; duration > 0 và ≤ 24 giờ; timestamp không quá xa tương lai; body không được có `userId`.
