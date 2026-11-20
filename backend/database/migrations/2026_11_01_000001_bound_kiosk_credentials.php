<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('kiosk_devices', function (Blueprint $table): void {
            $table->timestamp('credential_expires_at')->nullable();
        });
        DB::table('kiosk_devices')->update([
            'credential_expires_at' => DB::raw('DATE_ADD(paired_at, INTERVAL 30 DAY)'),
        ]);
        Schema::table('kiosk_pairing_codes', function (Blueprint $table): void {
            $table->unsignedBigInteger('renewal_device_id')->nullable();
            $table->foreign(['tenant_id', 'renewal_device_id', 'outlet_id'], 'kiosk_pairing_renewal_device_foreign')
                ->references(['tenant_id', 'id', 'outlet_id'])->on('kiosk_devices')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        if (! app()->environment('testing') || DB::connection()->getDatabaseName() !== 'hadirinaja_test') {
            throw new RuntimeException('Kiosk credential migration is forward-only outside the isolated test database.');
        }
        // MySQL can reuse the shortened renewal index for the Outlet FK after a column drop.
        if (! Schema::hasIndex('kiosk_pairing_codes', 'kiosk_pairings_outlet_foreign')) {
            Schema::table('kiosk_pairing_codes', function (Blueprint $table): void {
                $table->index(['tenant_id', 'outlet_id'], 'kiosk_pairings_outlet_foreign');
            });
        }
        Schema::table('kiosk_pairing_codes', function (Blueprint $table): void {
            $table->dropForeign('kiosk_pairing_renewal_device_foreign');
            $table->dropIndex('kiosk_pairing_renewal_device_foreign');
            $table->dropColumn('renewal_device_id');
        });
        Schema::table('kiosk_devices', function (Blueprint $table): void {
            $table->dropColumn('credential_expires_at');
        });
    }
};
