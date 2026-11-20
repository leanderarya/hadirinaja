<?php

namespace Tests\Unit;

use Illuminate\Database\Connection;
use PHPUnit\Framework\TestCase;
use RuntimeException;
use Tests\Support\DisposableTestDatabaseGuard;

final class DisposableTestDatabaseGuardTest extends TestCase
{
    private const ENVIRONMENT_KEYS = [
        'APP_ENV',
        'DB_URL',
        'DB_SOCKET',
        'HADIRINAJA_TEST_DISPOSABLE_DATABASE',
        'HADIRINAJA_TEST_DISPOSABLE_PORT',
        'HADIRINAJA_TEST_DISPOSABLE_DATADIR',
        'HADIRINAJA_TEST_DISPOSABLE_SOCKET',
    ];

    /** @var array<string, string|false> */
    private array $originalEnvironment = [];

    /** @var resource|null */
    private $serverSocket = null;

    private string $runDirectory;

    private string $dataDirectory;

    private string $socketPath;

    private string $databaseName;

    private string $port;

    /** @var array<string, mixed> */
    private array $config;

    protected function setUp(): void
    {
        parent::setUp();

        foreach (self::ENVIRONMENT_KEYS as $key) {
            $this->originalEnvironment[$key] = getenv($key);
        }

        $temporaryDirectory = realpath('/tmp');
        self::assertNotFalse($temporaryDirectory);
        $this->runDirectory = $temporaryDirectory.'/hadirinaja-p2d-run.'.bin2hex(random_bytes(4));
        $this->dataDirectory = $this->runDirectory.'/data';
        $this->socketPath = $this->runDirectory.'/mysql.sock';
        $this->databaseName = 'hadirinaja_p2d_'.gmdate('Ymd').'_'.bin2hex(random_bytes(6));
        $this->port = (string) random_int(45000, 54999);

        self::assertTrue(mkdir($this->runDirectory, 0700));
        self::assertTrue(file_put_contents($this->runDirectory.'/.hadirinaja-p2d-runner-owned', 'test') !== false);
        self::assertTrue(mkdir($this->dataDirectory, 0700));
        $this->serverSocket = @stream_socket_server('unix://'.$this->socketPath, $errorCode, $errorMessage);
        self::assertIsResource($this->serverSocket, $errorMessage);

        $this->config = [
            'driver' => 'mysql',
            'host' => '127.0.0.1',
            'port' => $this->port,
            'database' => $this->databaseName,
            'url' => '',
            'unix_socket' => '',
        ];

        $this->setEnvironment('APP_ENV', 'testing');
        $this->setEnvironment('DB_URL', '');
        $this->setEnvironment('DB_SOCKET', '');
        $this->setEnvironment('HADIRINAJA_TEST_DISPOSABLE_DATABASE', $this->databaseName);
        $this->setEnvironment('HADIRINAJA_TEST_DISPOSABLE_PORT', $this->port);
        $this->setEnvironment('HADIRINAJA_TEST_DISPOSABLE_DATADIR', $this->dataDirectory);
        $this->setEnvironment('HADIRINAJA_TEST_DISPOSABLE_SOCKET', $this->socketPath);
    }

    protected function tearDown(): void
    {
        if (is_resource($this->serverSocket)) {
            fclose($this->serverSocket);
        }

        foreach (self::ENVIRONMENT_KEYS as $key) {
            $value = $this->originalEnvironment[$key];
            if ($value === false) {
                putenv($key);
                unset($_ENV[$key], $_SERVER[$key]);
            } else {
                $this->setEnvironment($key, $value);
            }
        }

        @unlink($this->socketPath);
        @unlink($this->runDirectory.'/.hadirinaja-p2d-runner-owned');
        @rmdir($this->dataDirectory);
        @rmdir($this->runDirectory);

        parent::tearDown();
    }

    public function test_accepts_only_a_runner_owned_loopback_mysql_configuration(): void
    {
        DisposableTestDatabaseGuard::assertConfigured($this->config);

        $this->assertTrue(true);
    }

    public function test_rejects_missing_runner_environment_and_legacy_shared_database(): void
    {
        foreach ([
            'HADIRINAJA_TEST_DISPOSABLE_DATABASE',
            'HADIRINAJA_TEST_DISPOSABLE_PORT',
            'HADIRINAJA_TEST_DISPOSABLE_DATADIR',
            'HADIRINAJA_TEST_DISPOSABLE_SOCKET',
        ] as $key) {
            $this->assertConfiguredRejected($this->config, [$key => null]);
        }

        $legacyConfig = array_replace($this->config, [
            'port' => '3306',
            'database' => 'hadirinaja_test',
        ]);
        $this->assertConfiguredRejected($legacyConfig, [
            'HADIRINAJA_TEST_DISPOSABLE_DATABASE' => null,
            'HADIRINAJA_TEST_DISPOSABLE_PORT' => null,
            'HADIRINAJA_TEST_DISPOSABLE_DATADIR' => null,
            'HADIRINAJA_TEST_DISPOSABLE_SOCKET' => null,
        ]);
    }

    public function test_rejects_unsafe_or_inconsistent_connection_configuration(): void
    {
        foreach ([
            ['driver' => 'sqlite'],
            ['host' => 'localhost'],
            ['port' => '3306'],
            ['database' => 'hadirinaja_test'],
            ['url' => 'mysql://127.0.0.1/hadirinaja_test'],
            ['unix_socket' => '/tmp/mysql.sock'],
        ] as $changes) {
            $this->assertConfiguredRejected(array_replace($this->config, $changes));
        }

        $this->assertConfiguredRejected($this->config, ['DB_URL' => 'mysql://127.0.0.1/hadirinaja_test']);
        $this->assertConfiguredRejected($this->config, ['DB_SOCKET' => '/tmp/mysql.sock']);

        $this->assertConfiguredRejected($this->config, [
            'HADIRINAJA_TEST_DISPOSABLE_DATABASE' => 'hadirinaja_p2d_20261108_aaaaaaaaaaaa',
        ]);
        $this->assertConfiguredRejected($this->config, [
            'HADIRINAJA_TEST_DISPOSABLE_PORT' => '3306',
        ]);
    }

    public function test_rejects_paths_without_the_runner_marker_and_owned_socket(): void
    {
        $marker = $this->runDirectory.'/.hadirinaja-p2d-runner-owned';
        unlink($marker);
        $this->assertConfiguredRejected($this->config);
        file_put_contents($marker, 'test');

        $this->assertConfiguredRejected($this->config, [
            'HADIRINAJA_TEST_DISPOSABLE_DATADIR' => realpath('/tmp'),
        ]);

        fclose($this->serverSocket);
        $this->serverSocket = null;
        unlink($this->socketPath);
        file_put_contents($this->socketPath, 'not a socket');
        $this->assertConfiguredRejected($this->config);
    }

    public function test_connected_identity_is_verified_without_opening_a_database_connection(): void
    {
        $connection = $this->createMock(Connection::class);
        $connection->method('getConfig')->willReturn($this->config);
        $connection->expects($this->once())->method('selectOne')->willReturn((object) [
            'database_name' => $this->databaseName,
            'port' => $this->port,
            'data_directory' => realpath($this->dataDirectory),
            'socket' => realpath($this->socketPath),
        ]);

        DisposableTestDatabaseGuard::assertConnected($connection);
        $this->assertTrue(true);
    }

    public function test_rejects_connected_identity_mismatch(): void
    {
        $connection = $this->createMock(Connection::class);
        $connection->method('getConfig')->willReturn($this->config);
        $connection->expects($this->once())->method('selectOne')->willReturn((object) [
            'database_name' => 'hadirinaja_test',
            'port' => '3306',
            'data_directory' => '/var/lib/mysql',
            'socket' => '/tmp/mysql.sock',
        ]);

        $this->expectException(RuntimeException::class);
        DisposableTestDatabaseGuard::assertConnected($connection);
    }

    public function test_rechecks_configuration_before_querying_connected_identity(): void
    {
        $connection = $this->createMock(Connection::class);
        $connection->method('getConfig')->willReturn(array_replace($this->config, [
            'port' => '3306',
        ]));
        $connection->expects($this->never())->method('selectOne');

        $this->expectException(RuntimeException::class);
        DisposableTestDatabaseGuard::assertConnected($connection);
    }

    /** @param array<string, mixed> $config
     *  @param array<string, string|null> $environment
     */
    private function assertConfiguredRejected(array $config, array $environment = []): void
    {
        $previous = [];
        foreach ($environment as $key => $value) {
            $previous[$key] = getenv($key);
            if ($value === null) {
                putenv($key);
            } else {
                $this->setEnvironment($key, $value);
            }
        }

        try {
            try {
                DisposableTestDatabaseGuard::assertConfigured($config);
            } catch (RuntimeException) {
                return;
            }

            $this->fail('Unsafe database configuration was accepted.');
        } finally {
            foreach ($previous as $key => $value) {
                if ($value === false) {
                    putenv($key);
                    unset($_ENV[$key], $_SERVER[$key]);
                } else {
                    $this->setEnvironment($key, $value);
                }
            }
        }
    }

    private function setEnvironment(string $key, string $value): void
    {
        putenv($key.'='.$value);
        $_ENV[$key] = $value;
        $_SERVER[$key] = $value;
    }
}
