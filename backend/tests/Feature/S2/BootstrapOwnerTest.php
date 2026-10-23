<?php

namespace Tests\Feature\S2;

use App\Enums\TenantRole;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class BootstrapOwnerTest extends TestCase
{
    use RefreshDatabase;

    public function test_interactive_bootstrap_creates_one_hashed_owner_and_refuses_to_run_again(): void
    {
        $password = 'S2-throwaway-Owner-3841';

        $this->artisan('hadirinaja:bootstrap-owner')
            ->expectsQuestion('Nama Owner', 'Bootstrap Owner')
            ->expectsQuestion('Nama organisasi', 'Bootstrap Tenant')
            ->expectsQuestion('Email Owner', 'bootstrap-owner@example.test')
            ->expectsQuestion('Nomor telepon E.164 (opsional)', '')
            ->expectsQuestion('Kata sandi Owner', $password)
            ->expectsQuestion('Ulangi kata sandi Owner', $password)
            ->expectsConfirmation('Buat Owner bootstrap-owner@example.test dan organisasi Bootstrap Tenant?', 'yes')
            ->expectsOutputToContain('berhasil dibuat')
            ->assertExitCode(0);

        $user = User::query()->where('email', 'bootstrap-owner@example.test')->firstOrFail();
        $membership = $user->memberships()->with('roles')->firstOrFail();
        $this->assertTrue(Hash::check($password, $user->password));
        $this->assertTrue($membership->hasRole(TenantRole::Owner));
        $this->assertSame('Bootstrap Tenant', Tenant::query()->sole()->name);

        $this->artisan('hadirinaja:bootstrap-owner')
            ->expectsOutputToContain('tenant sudah ada')
            ->assertExitCode(1);
    }
}
