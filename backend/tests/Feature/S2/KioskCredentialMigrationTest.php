<?php

namespace Tests\Feature\S2;

use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class KioskCredentialMigrationTest extends TestCase
{
    use DatabaseMigrations;

    public function test_isolated_kiosk_migration_can_be_rolled_back_and_reapplied_repeatedly(): void
    {
        $migration = require database_path('migrations/2026_11_01_000001_bound_kiosk_credentials.php');
        for ($iteration = 0; $iteration < 2; $iteration++) {
            $migration->down();
            $this->assertFalse(Schema::hasColumn('kiosk_devices', 'credential_expires_at'));
            $this->assertFalse(Schema::hasColumn('kiosk_pairing_codes', 'renewal_device_id'));
            $migration->up();
            $this->assertTrue(Schema::hasColumn('kiosk_devices', 'credential_expires_at'));
            $this->assertTrue(Schema::hasColumn('kiosk_pairing_codes', 'renewal_device_id'));
        }
    }
}
