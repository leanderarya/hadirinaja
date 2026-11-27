<?php

namespace App\Support;

use Illuminate\Database\Connection;
use RuntimeException;

final class VerifiedDisposableTestDatabase
{
    /** @param array<string, mixed> $config */
    public static function isConfigured(array $config): bool
    {
        $expectedName = (string) getenv('HADIRINAJA_TEST_DISPOSABLE_DATABASE');
        $expectedPort = (string) getenv('HADIRINAJA_TEST_DISPOSABLE_PORT');
        $dataDirectory = realpath((string) getenv('HADIRINAJA_TEST_DISPOSABLE_DATADIR'));
        $temporaryDirectory = realpath('/tmp');
        $runDirectory = $dataDirectory === false ? false : dirname($dataDirectory);
        $marker = $runDirectory === false ? false : $runDirectory.'/.hadirinaja-p2d-runner-owned';
        $expectedSocket = (string) getenv('HADIRINAJA_TEST_DISPOSABLE_SOCKET');
        $socket = realpath($expectedSocket);
        $expectedUser = (string) getenv('DB_USERNAME');
        $expectedPassword = (string) getenv('DB_PASSWORD');
        $url = $config['url'] ?? '';

        return getenv('APP_ENV') === 'testing'
            && getenv('HADIRINAJA_TEST_SCHEMA_PREPARED') === '1'
            && ($config['driver'] ?? null) === 'mysql'
            && ($config['host'] ?? null) === '127.0.0.1'
            && is_string($url)
            && trim($url) === ''
            && (string) getenv('DB_URL') === ''
            && (string) ($config['unix_socket'] ?? '') === ''
            && (string) getenv('DB_SOCKET') === ''
            && $expectedName === 'hadirinaja_test'
            && ($config['database'] ?? null) === $expectedName
            && preg_match('/^p2d_runner_[a-f0-9]{12}$/', $expectedUser) === 1
            && ($config['username'] ?? null) === $expectedUser
            && $expectedPassword !== ''
            && ($config['password'] ?? null) === $expectedPassword
            && ctype_digit($expectedPort)
            && (int) $expectedPort > 1024
            && (int) $expectedPort <= 65535
            && $expectedPort !== '3306'
            && (string) ($config['port'] ?? '') === $expectedPort
            && $dataDirectory !== false
            && is_dir($dataDirectory)
            && $temporaryDirectory !== false
            && $runDirectory !== false
            && dirname($runDirectory) === $temporaryDirectory
            && preg_match('/^hadirinaja-p2d-run\.[A-Za-z0-9]{8}$/', basename($runDirectory)) === 1
            && basename($dataDirectory) === 'data'
            && ! is_link($marker)
            && is_file($marker)
            && $socket !== false
            && $socket === $runDirectory.'/mysql.sock'
            && @filetype($socket) === 'socket';
    }

    /** @param array<string, mixed> $config */
    public static function assertConfigured(array $config): void
    {
        if (! self::isConfigured($config)) {
            throw new RuntimeException('Backend operation requires the verified disposable local MySQL runner target.');
        }
    }

    public static function assertConnected(Connection $connection): void
    {
        self::assertConfigured($connection->getConfig());

        $identity = $connection->selectOne(
            'SELECT DATABASE() AS database_name, @@port AS port, @@datadir AS data_directory, @@socket AS socket, CURRENT_USER() AS account_name',
        );
        $expectedDataDirectory = realpath((string) getenv('HADIRINAJA_TEST_DISPOSABLE_DATADIR'));
        $expectedSocket = realpath((string) getenv('HADIRINAJA_TEST_DISPOSABLE_SOCKET'));
        $actualDataDirectory = is_object($identity) ? realpath((string) $identity->data_directory) : false;
        $actualSocket = is_object($identity) ? realpath((string) $identity->socket) : false;

        if (
            ! is_object($identity)
            || $identity->database_name !== getenv('HADIRINAJA_TEST_DISPOSABLE_DATABASE')
            || (string) $identity->port !== (string) getenv('HADIRINAJA_TEST_DISPOSABLE_PORT')
            || $identity->account_name !== getenv('DB_USERNAME').'@127.0.0.1'
            || $actualDataDirectory === false
            || $actualDataDirectory !== $expectedDataDirectory
            || $actualSocket === false
            || $actualSocket !== $expectedSocket
        ) {
            throw new RuntimeException('Backend operation connected outside its verified disposable MySQL instance.');
        }
    }
}
