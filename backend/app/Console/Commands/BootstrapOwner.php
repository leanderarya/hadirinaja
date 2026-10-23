<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Models\User;
use App\Services\OrganizationService;
use App\Support\IdentityNormalizer;
use Illuminate\Console\Command;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Symfony\Component\Console\Attribute\AsCommand;

#[AsCommand(name: 'hadirinaja:bootstrap-owner', description: 'Create the first HadirinAja Owner and Tenant interactively.')]
final class BootstrapOwner extends Command
{
    public function handle(OrganizationService $organization): int
    {
        if (Tenant::query()->exists()) {
            $this->components->error('Bootstrap dihentikan karena tenant sudah ada.');

            return self::FAILURE;
        }

        $name = trim((string) $this->ask('Nama Owner'));
        $tenantName = trim((string) $this->ask('Nama organisasi'));
        $email = IdentityNormalizer::email((string) $this->ask('Email Owner'));
        $phoneInput = trim((string) $this->ask('Nomor telepon E.164 (opsional)'));
        $password = (string) $this->secret('Kata sandi Owner');
        $passwordConfirmation = (string) $this->secret('Ulangi kata sandi Owner');

        if ($name === '' || $tenantName === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $this->components->error('Nama Owner, nama organisasi, dan email yang valid wajib diisi.');

            return self::FAILURE;
        }

        if (User::query()->where('email', $email)->exists()) {
            $this->components->error('Email tersebut sudah terdaftar.');

            return self::FAILURE;
        }

        try {
            $phone = $phoneInput === '' ? null : IdentityNormalizer::phone($phoneInput);
        } catch (InvalidArgumentException) {
            $this->components->error('Nomor telepon harus menggunakan format E.164.');

            return self::FAILURE;
        }

        if ($phone !== null && User::query()->where('phone', $phone)->exists()) {
            $this->components->error('Nomor telepon tersebut sudah terdaftar.');

            return self::FAILURE;
        }

        if (
            strlen($password) < 12 || strlen($password) > 72
            || preg_match('/[A-Za-z]/', $password) !== 1
            || preg_match('/\d/', $password) !== 1
            || ! hash_equals($password, $passwordConfirmation)
        ) {
            $this->components->error('Kata sandi harus cocok, 12–72 byte, serta memuat huruf dan angka.');

            return self::FAILURE;
        }

        if (! $this->confirm("Buat Owner {$email} dan organisasi {$tenantName}?", false)) {
            $this->components->warn('Bootstrap dibatalkan; tidak ada data dibuat.');

            return self::SUCCESS;
        }

        try {
            Cache::lock('hadirinaja:bootstrap-owner', 60)->block(5, function () use ($organization, $name, $tenantName, $email, $phone, $password): void {
                DB::transaction(function () use ($organization, $name, $tenantName, $email, $phone, $password): void {
                    if (Tenant::query()->lockForUpdate()->exists()) {
                        throw ValidationException::withMessages(['tenant' => 'Bootstrap sudah pernah dijalankan.']);
                    }

                    $user = User::query()->create([
                        'name' => $name,
                        'email' => $email,
                        'phone' => $phone,
                        'password' => $password,
                    ]);

                    $organization->createTenant($user, $tenantName);
                });
            });
        } catch (ValidationException) {
            $this->components->error('Bootstrap dihentikan karena tenant sudah ada.');

            return self::FAILURE;
        } catch (LockTimeoutException) {
            $this->components->error('Bootstrap sedang berjalan pada proses lain. Coba lagi nanti.');

            return self::FAILURE;
        } catch (QueryException) {
            $this->components->error('Bootstrap gagal karena identitas sudah digunakan atau penyimpanan menolak perubahan.');

            return self::FAILURE;
        }

        $this->components->info('Owner dan organisasi awal berhasil dibuat. Kata sandi tidak ditampilkan.');

        return self::SUCCESS;
    }
}
