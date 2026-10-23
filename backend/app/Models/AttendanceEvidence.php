<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'tenant_id', 'attendance_session_id', 'attendance_event_id', 'evidence_type', 'storage_path', 'detected_mime_type',
    'stored_mime_type', 'stored_size_bytes', 'image_width', 'image_height', 'sha256',
    'validation_status', 'received_at',
])]
class AttendanceEvidence extends Model
{
    use BelongsToTenant;

    public $timestamps = false;

    protected function casts(): array
    {
        return [
            'stored_size_bytes' => 'integer',
            'image_width' => 'integer',
            'image_height' => 'integer',
            'received_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(AttendanceEvent::class, 'attendance_event_id');
    }
}
