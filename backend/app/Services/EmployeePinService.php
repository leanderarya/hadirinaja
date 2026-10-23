<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\EmployeeOutletAssignment;
use App\Models\EmployeePinCredential;
use App\Models\EmployeePinEnrollmentCode;
use App\Models\KioskDevice;
use App\Models\Outlet;
use App\Models\TenantMembership;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;

final class EmployeePinService
{
    private static ?string $dummyHash = null;

    public function __construct(private readonly TenantAuthorization $authorization) {}

    /** @return array{code: string, expires_at: string} */
    public function issueEnrollmentCode(
        TenantMembership $actor,
        Employee $employee,
        Outlet $outlet,
    ): array {
        $owner = $this->authorization->requireOwner($actor);
        $tenantOutlet = Outlet::query()->forTenant((int) $owner->tenant_id)
            ->whereKey($outlet->getKey())->first();

        if (! $tenantOutlet || ! $this->authorization->canManageOutlet($owner, $tenantOutlet)) {
            throw ValidationException::withMessages(['employee' => 'Karyawan tidak tersedia untuk outlet ini.']);
        }

        return DB::transaction(function () use ($owner, $employee, $tenantOutlet): array {
            $tenantEmployee = Employee::query()->forTenant((int) $owner->tenant_id)
                ->whereKey($employee->getKey())->lockForUpdate()->first();

            if (! $tenantEmployee
                || ! $this->authorization->canManageEmployee($owner, $tenantEmployee)
                || ! $this->isEligibleAtOutlet($tenantEmployee, $tenantOutlet)) {
                throw ValidationException::withMessages(['employee' => 'Karyawan tidak tersedia untuk outlet ini.']);
            }

            $now = now();
            EmployeePinEnrollmentCode::query()->forTenant((int) $owner->tenant_id)
                ->where('employee_id', $tenantEmployee->getKey())
                ->whereNull('used_at')->whereNull('revoked_at')
                ->update(['revoked_at' => $now]);

            $code = Str::upper(Str::random(12));
            $expiresAt = $now->copy()->addMinutes(15);

            EmployeePinEnrollmentCode::query()->create([
                'tenant_id' => $owner->tenant_id,
                'employee_id' => $tenantEmployee->getKey(),
                'outlet_id' => $tenantOutlet->getKey(),
                'issued_by_membership_id' => $owner->getKey(),
                'code_hash' => $this->codeHash($code),
                'expires_at' => $expiresAt,
            ]);

            return ['code' => $code, 'expires_at' => $expiresAt->toIso8601String()];
        });
    }

    public function redeemEnrollmentCode(KioskDevice $device, string $code, string $pin): void
    {
        $normalizedCode = Str::upper(trim($code));

        if (preg_match('/^[A-Z0-9]{12}$/D', $normalizedCode) !== 1) {
            throw ValidationException::withMessages(['code' => 'Kode PIN tidak valid atau kedaluwarsa.']);
        }

        $this->assertPinFormat($pin);

        DB::transaction(function () use ($device, $normalizedCode, $pin): void {
            $codeHash = $this->codeHash($normalizedCode);
            $candidate = EmployeePinEnrollmentCode::query()->forTenant((int) $device->tenant_id)
                ->where('code_hash', $codeHash)->first();

            if (! $candidate) {
                throw ValidationException::withMessages(['code' => 'Kode PIN tidak valid atau kedaluwarsa.']);
            }

            $employee = Employee::query()->forTenant((int) $device->tenant_id)
                ->whereKey($candidate->employee_id)->lockForUpdate()->first();
            $enrollment = EmployeePinEnrollmentCode::query()->forTenant((int) $device->tenant_id)
                ->whereKey($candidate->getKey())->where('code_hash', $codeHash)
                ->lockForUpdate()->first();

            if (! $employee || ! $enrollment || $enrollment->used_at !== null || $enrollment->revoked_at !== null
                || $enrollment->expires_at->isPast() || (int) $enrollment->outlet_id !== (int) $device->outlet_id) {
                throw ValidationException::withMessages(['code' => 'Kode PIN tidak valid atau kedaluwarsa.']);
            }

            if (! $this->isEligibleAtOutlet($employee, $device->outlet)) {
                throw ValidationException::withMessages(['code' => 'Kode PIN tidak valid atau kedaluwarsa.']);
            }

            EmployeePinCredential::query()->updateOrCreate(
                ['tenant_id' => $device->tenant_id, 'employee_id' => $employee->getKey()],
                ['pin_hash' => Hash::make($pin), 'changed_at' => now()],
            );

            $enrollment->forceFill(['used_at' => now()])->save();
        });
    }

    public function verify(KioskDevice $device, int $employeeId, string $pin, bool $requireCurrentAssignment = true): ?Employee
    {
        $this->assertPinFormat($pin);
        $key = $this->rateLimitKey($device, $employeeId);

        if (RateLimiter::tooManyAttempts($key, 5)) {
            throw new TooManyRequestsHttpException(
                RateLimiter::availableIn($key),
                'PIN tidak dapat diverifikasi saat ini.',
            );
        }

        RateLimiter::hit($key, 900);

        $employee = Employee::query()->forTenant((int) $device->tenant_id)
            ->whereKey($employeeId)->first();
        $credential = $employee
            ? EmployeePinCredential::query()->forTenant((int) $device->tenant_id)
                ->where('employee_id', $employee->getKey())->first()
            : null;
        $hash = $credential?->pin_hash ?? (self::$dummyHash ??= Hash::make('invalid-pin-placeholder'));
        $validPin = Hash::check($pin, $hash);

        if (! $employee || ! $credential || ! $validPin
            || ($requireCurrentAssignment && ! $this->isEligibleAtOutlet($employee, $device->outlet))) {
            return null;
        }

        RateLimiter::clear($key);

        return $employee;
    }

    private function isEligibleAtOutlet(Employee $employee, Outlet $outlet): bool
    {
        return EmployeeOutletAssignment::query()->forTenant((int) $employee->tenant_id)
            ->where('employee_id', $employee->getKey())
            ->where('outlet_id', $outlet->getKey())
            ->where('effective_from', '<=', now())
            ->where('effective_until', '>', now())
            ->exists();
    }

    private function rateLimitKey(KioskDevice $device, int $employeeId): string
    {
        return 'employee-pin:'.hash_hmac(
            'sha256',
            $device->getKey().':'.$device->tenant_id.':'.$employeeId,
            (string) config('app.key'),
        );
    }

    private function codeHash(string $code): string
    {
        return hash_hmac('sha256', $code, (string) config('app.key'));
    }

    private function assertPinFormat(string $pin): void
    {
        if (preg_match('/^\d{6,8}$/D', $pin) !== 1) {
            throw ValidationException::withMessages(['pin' => 'PIN harus terdiri dari 6 sampai 8 angka.']);
        }
    }
}
