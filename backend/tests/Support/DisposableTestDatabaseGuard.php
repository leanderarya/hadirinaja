<?php

namespace Tests\Support;

use Illuminate\Database\Connection;
use RuntimeException;

final class DisposableTestDatabaseGuard
{
    /** @param array<string, mixed> $config */
    public static function assertConfigured(array $config): void
    {
        $expectedName = (string) getenv('HADIRINAJA_TEST_DISPOSABLE_DATABASE');
        $expectedPort = (string) getenv('HADIRINAJA_TEST_DISPOSABLE_PORT');
        $expectedDataDirectory = (string) getenv('HADIRINAJA_TEST_DISPOSABLE_DATADIR');
        $expectedSocket = (string) getenv('HADIRINAJA_TEST_DISPOSABLE_SOCKET');
        $port = (string) ($config['port'] ?? '');
        $dataDirectory = realpath($expectedDataDirectory);
        $temporaryDirectory = realpath('/tmp');
        $runDirectory = $dataDirectory === false ? false : dirname($dataDirectory);
        $marker = $runDirectory === false
            ? false
            : $runDirectory.'/.hadirinaja-p2d-runner-owned';
        $socket = realpath($expectedSocket);
        $runnerOwnsTarget = $temporaryDirectory !== false
            && $runDirectory !== false
            && dirname($runDirectory) === $temporaryDirectory
            && preg_match('/^hadirinaja-p2d-run\.[A-Za-z0-9]{8}$/', basename($runDirectory)) === 1
            && basename((string) $dataDirectory) === 'data'
            && ! is_link($marker)
            && is_file($marker)
            && $socket !== false
            && $socket === $runDirectory.'/mysql.sock'
            && @filetype($socket) === 'socket';
        $url = $config['url'] ?? '';
        $clientSocket = (string) ($config['unix_socket'] ?? '');
        $urlEnvironment = getenv('DB_URL');
        $socketEnvironment = getenv('DB_SOCKET');

        if (
            getenv('APP_ENV') !== 'testing'
            || ($config['driver'] ?? null) !== 'mysql'
            || ($config['host'] ?? null) !== '127.0.0.1'
            || ! is_string($url)
            || trim($url) !== ''
            || (is_string($urlEnvironment) && trim($urlEnvironment) !== '')
            || $clientSocket !== ''
            || (is_string($socketEnvironment) && trim($socketEnvironment) !== '')
            || ! preg_match('/^hadirinaja_p2d_[0-9]{8}_[a-f0-9]{12}$/', $expectedName)
            || in_array($expectedName, ['hadirinaja_test', 'hadirinaja_dev'], true)
            || ($config['database'] ?? null) !== $expectedName
            || $expectedPort === '3306'
            || ! ctype_digit($expectedPort)
            || (int) $expectedPort < 1024
            || (int) $expectedPort > 65535
            || $port !== $expectedPort
            || $dataDirectory === false
            || ! is_dir($dataDirectory)
            || ! $runnerOwnsTarget
        ) {
            throw new RuntimeException('Backend tests require the verified disposable local MySQL runner target.');
        }
    }

    public static function assertConnected(Connection $connection): void
    {
        self::assertConfigured($connection->getConfig());

        $expectedName = (string) getenv('HADIRINAJA_TEST_DISPOSABLE_DATABASE');
        $expectedPort = (string) getenv('HADIRINAJA_TEST_DISPOSABLE_PORT');
        $expectedDataDirectory = realpath((string) getenv('HADIRINAJA_TEST_DISPOSABLE_DATADIR'));
        $expectedSocket = realpath((string) getenv('HADIRINAJA_TEST_DISPOSABLE_SOCKET'));
        $identity = $connection->selectOne(
            'SELECT DATABASE() AS database_name, @@port AS port, @@datadir AS data_directory, @@socket AS socket',
        );
        if (! is_object($identity)) {
            throw new RuntimeException('Backend tests could not verify the connected MySQL instance.');
        }

        $actualDataDirectory = realpath((string) $identity->data_directory);
        $actualSocket = realpath((string) $identity->socket);

        if (
            $identity->database_name !== $expectedName
            || (string) $identity->port !== $expectedPort
            || $actualDataDirectory === false
            || $actualDataDirectory !== $expectedDataDirectory
            || $actualSocket === false
            || $actualSocket !== $expectedSocket
        ) {
            throw new RuntimeException('Backend tests connected outside their verified disposable MySQL instance.');
        }
    }
}
