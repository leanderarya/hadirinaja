<?php

namespace App\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class AttendanceEvidenceLegalHoldReader
{
    public function hasActiveHold(int $tenantId, int $evidenceId, ?Carbon $now = null): bool
    {
        $now ??= now('UTC');

        return DB::table('attendance_evidence_legal_hold_events as placed')
            ->where('placed.tenant_id', $tenantId)
            ->where('placed.attendance_evidence_id', $evidenceId)
            ->where('placed.action', 'placed')
            ->where(function (Builder $active) use ($now): void {
                $active->whereNull('placed.expires_at')->orWhere('placed.expires_at', '>', $now->format('Y-m-d H:i:s'));
            })
            ->whereNotExists(function (Builder $release): void {
                $release->selectRaw('1')->from('attendance_evidence_legal_hold_events as released')
                    ->whereColumn('released.tenant_id', 'placed.tenant_id')
                    ->whereColumn('released.attendance_evidence_id', 'placed.attendance_evidence_id')
                    ->whereColumn('released.hold_reference', 'placed.hold_reference')
                    ->whereColumn('released.id', '>', 'placed.id')
                    ->whereIn('released.action', ['released', 'expired']);
            })
            ->exists();
    }

    public function hasPendingPreservationLease(int $tenantId, int $evidenceId, ?Carbon $now = null): bool
    {
        $now ??= now('UTC');

        return DB::table('attendance_evidence_legal_hold_requests')
            ->where('tenant_id', $tenantId)
            ->where('attendance_evidence_id', $evidenceId)
            ->where('status', 'pending')
            ->where('preservation_lease_granted', true)
            ->where('lease_expires_at', '>', $now->format('Y-m-d H:i:s'))
            ->exists();
    }

    public function pendingLeaseExpiry(int $tenantId, int $evidenceId, ?Carbon $now = null): ?Carbon
    {
        $now ??= now('UTC');
        $expiry = DB::table('attendance_evidence_legal_hold_requests')
            ->where('tenant_id', $tenantId)
            ->where('attendance_evidence_id', $evidenceId)
            ->where('status', 'pending')
            ->where('preservation_lease_granted', true)
            ->where('lease_expires_at', '>', $now->format('Y-m-d H:i:s'))
            ->min('lease_expires_at');

        return $expiry ? Carbon::parse($expiry, 'UTC') : null;
    }
}
