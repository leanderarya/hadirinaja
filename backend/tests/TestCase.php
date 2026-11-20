<?php

namespace Tests;

use Illuminate\Foundation\Testing\RefreshDatabaseState;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use RuntimeException;
use Tests\Support\DisposableTestDatabaseGuard;

abstract class TestCase extends BaseTestCase
{
    private static bool $preparedSchemaValidated = false;

    public function createApplication()
    {
        $app = parent::createApplication();
        $connection = $app['config']->get('database.default');
        $database = $app['config']->get('database.connections.mysql');

        if ($connection !== 'mysql') {
            throw new RuntimeException('Backend tests require the disposable local MySQL test runner.');
        }

        DisposableTestDatabaseGuard::assertConfigured($database);
        $databaseConnection = $app['db']->connection();
        DisposableTestDatabaseGuard::assertConnected($databaseConnection);

        if (! self::$preparedSchemaValidated && getenv('HADIRINAJA_TEST_SCHEMA_PREPARED') === '1') {
            $migrationFiles = glob($app->databasePath('migrations/*.php'));
            $expectedMigrations = array_map(
                static fn (string $file): string => pathinfo($file, PATHINFO_FILENAME),
                $migrationFiles,
            );
            $expectedTriggers = [];
            foreach ($migrationFiles as $file) {
                preg_match_all('/CREATE TRIGGER\s+(\w+)/', file_get_contents($file), $matches);
                $expectedTriggers = [...$expectedTriggers, ...$matches[1]];
            }
            $actualTriggers = array_column($databaseConnection->select(
                'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?',
                [$databaseConnection->getDatabaseName()],
            ), 'TRIGGER_NAME');
            if (array_diff($expectedMigrations, $databaseConnection->table('migrations')->pluck('migration')->all())
                || array_diff($expectedTriggers, $actualTriggers)) {
                throw new RuntimeException('Prepared test schema must contain every migration and security trigger.');
            }

            self::$preparedSchemaValidated = true;
            RefreshDatabaseState::$migrated = true;
        }

        return $app;
    }

    /** @return array<string, string> */
    protected function disposableDatabaseWorkerEnvironment(): array
    {
        $database = config('database.connections.mysql');

        return [
            'APP_ENV' => 'testing',
            'DB_CONNECTION' => 'mysql',
            'DB_HOST' => (string) $database['host'],
            'DB_PORT' => (string) $database['port'],
            'DB_DATABASE' => (string) $database['database'],
            'DB_USERNAME' => (string) $database['username'],
            'DB_PASSWORD' => (string) $database['password'],
            'DB_URL' => '',
            'DB_SOCKET' => '',
            'HADIRINAJA_TEST_DISPOSABLE_DATABASE' => (string) getenv('HADIRINAJA_TEST_DISPOSABLE_DATABASE'),
            'HADIRINAJA_TEST_DISPOSABLE_PORT' => (string) getenv('HADIRINAJA_TEST_DISPOSABLE_PORT'),
            'HADIRINAJA_TEST_DISPOSABLE_DATADIR' => (string) getenv('HADIRINAJA_TEST_DISPOSABLE_DATADIR'),
            'HADIRINAJA_TEST_DISPOSABLE_SOCKET' => (string) getenv('HADIRINAJA_TEST_DISPOSABLE_SOCKET'),
            'HADIRINAJA_TEST_SCHEMA_PREPARED' => '1',
        ];
    }
}
