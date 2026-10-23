<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kiosk_devices', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('outlet_id');
            $table->string('name', 120);
            $table->char('credential_hash', 64)->unique();
            $table->timestamp('paired_at');
            $table->timestamp('revoked_at')->nullable()->index();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamps();
            $table->unique(['tenant_id', 'id']);
            $table->index(['tenant_id', 'outlet_id', 'revoked_at']);
            $table->foreign(['tenant_id', 'outlet_id'], 'kiosk_devices_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
        });

        Schema::create('kiosk_pairing_codes', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('outlet_id');
            $table->unsignedBigInteger('issued_by_membership_id');
            $table->unsignedBigInteger('device_id')->nullable();
            $table->string('device_name', 120);
            $table->char('code_hash', 64)->unique();
            $table->timestamp('expires_at')->index();
            $table->timestamp('redeemed_at')->nullable();
            $table->timestamps();
            $table->foreign(['tenant_id', 'outlet_id'], 'kiosk_pairings_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
            $table->foreign(['tenant_id', 'issued_by_membership_id'], 'kiosk_pairings_issuer_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->foreign(['tenant_id', 'device_id'], 'kiosk_pairings_device_foreign')
                ->references(['tenant_id', 'id'])->on('kiosk_devices')->restrictOnDelete();
        });

        Schema::create('employee_pin_credentials', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->string('pin_hash');
            $table->timestamp('changed_at');
            $table->timestamps();
            $table->unique(['tenant_id', 'employee_id'], 'employee_pin_credentials_employee_unique');
            $table->foreign(['tenant_id', 'employee_id'], 'employee_pin_credentials_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
        });

        Schema::create('employee_pin_enrollment_codes', function (Blueprint $table) {
            $table->innoDb();
            $table->id();
            $table->unsignedBigInteger('tenant_id');
            $table->unsignedBigInteger('employee_id');
            $table->unsignedBigInteger('outlet_id');
            $table->unsignedBigInteger('issued_by_membership_id');
            $table->char('code_hash', 64)->unique();
            $table->timestamp('expires_at')->index();
            $table->timestamp('used_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();
            $table->foreign(['tenant_id', 'employee_id'], 'employee_pin_enrollments_employee_foreign')
                ->references(['tenant_id', 'id'])->on('employees')->restrictOnDelete();
            $table->foreign(['tenant_id', 'outlet_id'], 'employee_pin_enrollments_outlet_foreign')
                ->references(['tenant_id', 'id'])->on('outlets')->restrictOnDelete();
            $table->foreign(['tenant_id', 'issued_by_membership_id'], 'employee_pin_enrollments_issuer_foreign')
                ->references(['tenant_id', 'id'])->on('tenant_memberships')->restrictOnDelete();
            $table->index(['tenant_id', 'employee_id', 'expires_at'], 'employee_pin_enrollments_employee_expiry_index');
        });
    }

    public function down(): void
    {
        $connection = (string) config('database.default');
        $database = (string) config("database.connections.{$connection}.database");

        if (! app()->environment('testing') || $database !== 'hadirinaja_test') {
            throw new RuntimeException('This migration is forward-only outside the isolated HadirinAja test database.');
        }

        Schema::dropIfExists('employee_pin_enrollment_codes');
        Schema::dropIfExists('employee_pin_credentials');
        Schema::dropIfExists('kiosk_pairing_codes');
        Schema::dropIfExists('kiosk_devices');
    }
};
