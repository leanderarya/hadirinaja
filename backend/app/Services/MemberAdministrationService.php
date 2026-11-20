<?php

namespace App\Services;

use App\Enums\TenantRole;
use App\Models\Employee;
use App\Models\EmployeeUserLink;
use App\Models\ManagementChangeEvent;
use App\Models\Outlet;
use App\Models\SupervisorOutletScope;
use App\Models\Tenant;
use App\Models\TenantAccessInvitation;
use App\Models\TenantMembership;
use App\Models\TenantRoleAssignment;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

final class MemberAdministrationService
{
    public function __construct(private readonly TenantAuthorization $authorization) {}

    public function changeRole(TenantMembership $actor, int $id, array $data): void
    {
        DB::transaction(function () use ($actor, $id, $data): void {
            [$owner, $target] = $this->lockTarget($actor, $id);
            $this->password($owner, $data['password']);
            if ((! $target->is_active || $target->revoked_at !== null) && ! ($data['reactivate'] ?? false)) {
                throw ValidationException::withMessages(['reactivate' => 'Konfirmasi pengaktifan kembali akses diperlukan.']);
            }
            $role = TenantRole::from($data['role']);
            if ($role !== TenantRole::Owner && $target->is_active && $target->roles()->where('role', 'owner')->exists()) {
                $this->anotherOwner($target);
            }
            $employee = null;
            if ($role === TenantRole::Employee) {
                $employee = Employee::query()->forTenant((int) $owner->tenant_id)->whereKey($data['employee_id'])->lockForUpdate()->firstOrFail();
                if (EmployeeUserLink::query()->forTenant((int) $owner->tenant_id)->where('employee_id', $employee->id)->where('tenant_membership_id', '!=', $id)->exists()) {
                    throw ValidationException::withMessages(['employee_id' => 'Profil ini sudah ditautkan ke akun lain.']);
                }
            }
            $outlets = array_values(array_unique($data['outlet_ids'] ?? []));
            if ($role === TenantRole::Supervisor && (count($outlets) === 0 || Outlet::query()->forTenant((int) $owner->tenant_id)->whereIn('id', $outlets)->count() !== count($outlets))) {
                throw ValidationException::withMessages(['outlet_ids' => 'Pilih Outlet Supervisor dalam organisasi ini.']);
            }
            $before = $this->snapshot($target);
            $tenant = (int) $owner->tenant_id;
            EmployeeUserLink::query()->forTenant($tenant)->where('tenant_membership_id', $id)->delete();
            SupervisorOutletScope::query()->forTenant($tenant)->where('tenant_membership_id', $id)->delete();
            TenantRoleAssignment::query()->forTenant($tenant)->where('tenant_membership_id', $id)->delete();
            $target->forceFill(['is_active' => true, 'revoked_at' => null])->save();
            TenantRoleAssignment::query()->create(['tenant_id' => $tenant, 'tenant_membership_id' => $id, 'role' => $role->value]);
            if ($employee) {
                EmployeeUserLink::query()->create(['tenant_id' => $tenant, 'tenant_membership_id' => $id, 'employee_id' => $employee->id]);
            }
            if ($role === TenantRole::Supervisor) {
                foreach ($outlets as $outlet) {
                    SupervisorOutletScope::query()->create(['tenant_id' => $tenant, 'tenant_membership_id' => $id, 'outlet_id' => $outlet]);
                }
            }
            // A direct Owner decision supersedes unused invitations, never accepted history.
            $invitations = TenantAccessInvitation::query()->forTenant($tenant)->whereNull('accepted_at')->whereNull('revoked_at')
                ->where(function ($query) use ($target, $employee): void {
                    $query->where('invitee_email', $target->user->email)->orWhere('intended_user_id', $target->user_id);
                    if ($employee) {
                        $query->orWhere('employee_id', $employee->id);
                    }
                })->lockForUpdate()->get();
            foreach ($invitations as $invitation) {
                $invitation->forceFill(['revoked_at' => now()])->save();
            }
            $this->audit($owner, $id, 'role_changed', $data['reason'], ['before' => $before, 'after' => $this->snapshot($target), 'revoked_invitation_ids' => $invitations->modelKeys()]);
        });
    }

    public function preview(TenantMembership $actor, int $id, ?int $employeeId): array
    {
        $owner = $this->authorization->requireOwner($actor);
        $target = TenantMembership::query()->forTenant((int) $owner->tenant_id)->whereKey($id)->firstOrFail();
        $employee = $this->deletionEmployee($target, $employeeId);
        $blocks = $this->blockers($target, $employee);
        if ($target->user_id === $owner->user_id) {
            $blocks['self'] = 1;
        }
        if ($target->is_active && $target->roles()->where('role', 'owner')->exists() && ! $this->hasAnotherOwner($target)) {
            $blocks['last_owner'] = 1;
        }

        return ['can_delete' => $blocks === [], 'blockers' => $blocks, 'employee_id' => $employee?->id, 'global_login_preserved' => true];
    }

    public function deletePermanently(TenantMembership $actor, int $id, array $data): void
    {
        try {
            DB::transaction(function () use ($actor, $id, $data): void {
                [$owner, $target] = $this->lockTarget($actor, $id);
                $this->password($owner, $data['password']);
                if (strtolower(trim($data['confirmation_email'])) !== $target->user->email) {
                    throw ValidationException::withMessages(['confirmation_email' => 'Ketik email akun yang akan dihapus dari organisasi ini.']);
                }
                if ($target->is_active && $target->roles()->where('role', 'owner')->exists()) {
                    $this->anotherOwner($target);
                }
                $employee = $this->deletionEmployee($target, $data['employee_id'] ?? null, true);
                if ($blocks = $this->blockers($target, $employee)) {
                    throw ValidationException::withMessages(['history' => 'Tidak dapat dihapus permanen karena masih mempunyai riwayat atau referensi tersimpan. Gunakan nonaktifkan atau cabut akses.']);
                }
                $before = $this->snapshot($target);
                $before['deleted_employee'] = $employee?->only(['id', 'name']);
                $tenant = (int) $owner->tenant_id;
                foreach ([EmployeeUserLink::class, SupervisorOutletScope::class, TenantRoleAssignment::class] as $model) {
                    $model::query()->forTenant($tenant)->where('tenant_membership_id', $id)->delete();
                }
                if ($employee) {
                    $employee->delete();
                }
                $target->delete();
                $this->audit($owner, $id, 'permanently_deleted', $data['reason'], ['before' => $before, 'global_login_preserved' => true]);
            });
        } catch (QueryException $e) {
            if ((int) ($e->errorInfo[1] ?? 0) !== 1451) {
                throw $e;
            }
            throw ValidationException::withMessages(['history' => 'Referensi data berubah. Tidak ada data yang dihapus; periksa ulang riwayat.']);
        }
    }

    private function lockTarget(TenantMembership $actor, int $id): array
    {
        Tenant::query()->whereKey($actor->tenant_id)->lockForUpdate()->firstOrFail();
        $owner = $this->authorization->requireOwner($actor);
        $target = TenantMembership::query()->forTenant((int) $owner->tenant_id)->whereKey($id)->lockForUpdate()->firstOrFail();
        if ($target->user_id === $owner->user_id) {
            throw ValidationException::withMessages(['membership' => 'Gunakan akun Owner aktif lain untuk mengubah role atau menghapus keanggotaan Anda sendiri.']);
        }

        return [$owner, $target];
    }

    private function password(TenantMembership $owner, string $password): void
    {
        if (! Hash::check($password, $owner->user->password)) {
            throw ValidationException::withMessages(['password' => 'Password Owner tidak sesuai.']);
        }
    }

    private function hasAnotherOwner(TenantMembership $target): bool
    {
        return TenantMembership::query()->forTenant((int) $target->tenant_id)->where('id', '!=', $target->id)->where('is_active', true)->whereNull('revoked_at')->whereHas('roles', fn ($q) => $q->where('role', 'owner'))->exists();
    }

    private function anotherOwner(TenantMembership $target): void
    {
        if (! $this->hasAnotherOwner($target)) {
            throw ValidationException::withMessages(['membership' => 'Organisasi harus tetap memiliki Owner aktif.']);
        }
    }

    private function deletionEmployee(TenantMembership $target, ?int $employeeId, bool $lock = false): ?Employee
    {
        $linked = $target->employeeUserLink()->value('employee_id');
        if ($linked !== null && $employeeId !== null && (int) $linked !== $employeeId) {
            throw ValidationException::withMessages(['employee_id' => 'Profil harus sesuai dengan akun yang dipilih.']);
        }
        $id = $linked ?? $employeeId;
        if ($id === null) {
            return null;
        }
        $query = Employee::query()->forTenant((int) $target->tenant_id)->whereKey($id);
        $employee = ($lock ? $query->lockForUpdate() : $query)->firstOrFail();
        if (EmployeeUserLink::query()->forTenant((int) $target->tenant_id)->where('employee_id', $id)->where('tenant_membership_id', '!=', $target->id)->exists()) {
            throw ValidationException::withMessages(['employee_id' => 'Profil terhubung ke akun lain.']);
        }

        return $employee;
    }

    private function blockers(TenantMembership $target, ?Employee $employee): array
    {
        // Inspect every incoming FK, including future schema additions. Never cascade audit/history.
        $refs = DB::select('SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IN (?,?) AND REFERENCED_COLUMN_NAME=?', ['tenant_memberships', 'employees', 'id']);
        $blocks = [];
        foreach ($refs as $ref) {
            $membership = $ref->REFERENCED_TABLE_NAME === 'tenant_memberships';
            if (! $membership && ! $employee) {
                continue;
            }
            $cleanup = $membership ? ['tenant_role_assignments', 'supervisor_outlet_scopes', 'employee_user_links'] : ['employee_user_links'];
            if (in_array($ref->TABLE_NAME, $cleanup, true)) {
                continue;
            }
            $count = DB::table($ref->TABLE_NAME)->where($ref->COLUMN_NAME, $membership ? $target->id : $employee->id)->count();
            if ($count) {
                $blocks[$ref->TABLE_NAME.'.'.$ref->COLUMN_NAME] = $count;
            }
        }
        $auditCount = ManagementChangeEvent::query()->forTenant((int) $target->tenant_id)
            ->where(function ($query) use ($target, $employee): void {
                $query->where(fn ($q) => $q->where('subject_type', 'membership')->where('subject_id', $target->id));
                if ($employee) {
                    $query->orWhere(fn ($q) => $q->where('subject_type', 'employee')->where('subject_id', $employee->id));
                }
            })->count();
        if ($auditCount) {
            $blocks['management_change_events.subject'] = $auditCount;
        }
        $invitationCount = TenantAccessInvitation::query()->forTenant((int) $target->tenant_id)
            ->where(fn ($q) => $q->where('invitee_email', $target->user->email)->orWhere('intended_user_id', $target->user_id)->orWhere('accepted_by_user_id', $target->user_id))->count();
        if ($invitationCount) {
            $blocks['tenant_access_invitations.recipient'] = $invitationCount;
        }

        return $blocks;
    }

    private function snapshot(TenantMembership $member): array
    {
        return ['membership_id' => $member->id, 'user_id' => $member->user_id, 'email' => $member->user->email, 'is_active' => $member->is_active, 'revoked_at' => $member->revoked_at?->toIso8601String(), 'roles' => $member->roles()->pluck('role')->map(fn ($role) => $role instanceof TenantRole ? $role->value : $role)->all(), 'employee_id' => $member->employeeUserLink()->value('employee_id'), 'outlet_ids' => $member->supervisorScopes()->pluck('outlet_id')->all()];
    }

    private function audit(TenantMembership $owner, int $id, string $action, string $reason, array $details): void
    {
        ManagementChangeEvent::query()->create(['tenant_id' => $owner->tenant_id, 'actor_user_id' => $owner->user_id, 'actor_membership_id' => $owner->id, 'subject_type' => 'membership', 'subject_id' => $id, 'action' => $action, 'changed_fields' => ['roles', 'employee_link', 'outlet_scope', 'membership_status'], 'details' => ['reason' => $reason, ...$details], 'occurred_at' => now()]);
    }
}
