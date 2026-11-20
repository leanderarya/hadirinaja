<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use RuntimeException;

final class EmployeeUatDatabaseGuard
{
    private const DATABASE = 'hadirinaja_uat';

    private const HOST = '127.0.0.1';

    private const PORT = 3307;

    private const USER = 'hadirinaja_uat_app';

    private const SERVER_ID = 19701;

    private const SHARED_SERVER_UUID = '4f255168-56ba-11f1-b549-b909fddd5d37';

    /** @return array<string, mixed> */
    public static function assertTarget(): array
    {
        $connection = config('database.connections.mysql');
        $expectedDataDirectory = realpath((string) env('HADIRINAJA_UAT_DATADIR'));
        $expectedSocket = realpath((string) env('HADIRINAJA_UAT_SOCKET'));
        $expectedUuid = (string) env('HADIRINAJA_UAT_SERVER_UUID');

        if (app()->environment() !== 'local'
            || config('database.default') !== 'mysql'
            || ($connection['driver'] ?? null) !== 'mysql'
            || ($connection['database'] ?? null) !== self::DATABASE
            || ($connection['host'] ?? null) !== self::HOST
            || (int) ($connection['port'] ?? 0) !== self::PORT
            || ($connection['username'] ?? null) !== self::USER
            || filled($connection['url'] ?? null)
            || filled($connection['unix_socket'] ?? null)
            || $expectedDataDirectory === false
            || $expectedSocket === false
            || $expectedUuid === ''
        ) {
            throw new RuntimeException('Employee UAT database configuration did not pass its isolation guard.');
        }

        $db = DB::connection('mysql');
        $identity = $db->selectOne(<<<'SQL'
            SELECT DATABASE() AS database_name,
                @@datadir AS data_directory,
                @@socket AS socket_path,
                @@port AS port,
                @@server_uuid AS server_uuid,
                @@server_id AS server_id,
                VERSION() AS server_version,
                @@bind_address AS bind_address,
                @@log_bin AS log_bin,
                @@binlog_format AS binlog_format,
                @@log_bin_trust_function_creators AS trust_trigger_creators,
                CURRENT_USER() AS authenticated_account
            SQL);

        $actualDataDirectory = realpath((string) $identity->data_directory);
        $actualSocket = realpath((string) $identity->socket_path);
        $account = (string) $identity->authenticated_account;

        if ($identity->database_name !== self::DATABASE
            || $actualDataDirectory !== $expectedDataDirectory
            || $actualSocket !== $expectedSocket
            || (int) $identity->port !== self::PORT
            || (string) $identity->server_uuid !== $expectedUuid
            || (string) $identity->server_uuid === self::SHARED_SERVER_UUID
            || (int) $identity->server_id !== self::SERVER_ID
            || ! str_starts_with((string) $identity->server_version, '9.7.1')
            || (string) $identity->bind_address !== self::HOST
            || ! in_array($identity->log_bin, [1, '1', true], true)
            || strtoupper((string) $identity->binlog_format) !== 'ROW'
            || ! in_array($identity->trust_trigger_creators, [1, '1', true], true)
            || $account !== self::USER.'@'.self::HOST
        ) {
            throw new RuntimeException('Connected MySQL server identity or local binlog configuration did not pass its isolation guard.');
        }

        $grantScopes = [];
        foreach ($db->select('SHOW GRANTS FOR CURRENT_USER') as $row) {
            $grant = strtoupper(str_replace('`', '', (string) array_values((array) $row)[0]));
            if (str_starts_with($grant, 'GRANT USAGE ON *.*')) {
                $grantScopes[] = 'USAGE ON *.*';

                continue;
            }

            if (! str_starts_with($grant, 'GRANT ALL PRIVILEGES ON '.strtoupper(self::DATABASE).'.*')
                || str_contains($grant, 'WITH GRANT OPTION')
            ) {
                throw new RuntimeException('Employee UAT app account has an unexpected or global grant.');
            }

            $grantScopes[] = 'ALL PRIVILEGES ON '.self::DATABASE.'.*';
        }

        if (! in_array('ALL PRIVILEGES ON '.self::DATABASE.'.*', $grantScopes, true)) {
            throw new RuntimeException('Employee UAT app account is missing its schema-scoped migration grant.');
        }

        return [
            'database' => (string) $identity->database_name,
            'data_directory' => (string) $identity->data_directory,
            'socket' => (string) $identity->socket_path,
            'port' => (int) $identity->port,
            'server_uuid' => (string) $identity->server_uuid,
            'server_id' => (int) $identity->server_id,
            'server_version' => (string) $identity->server_version,
            'bind_address' => (string) $identity->bind_address,
            'log_bin' => (bool) $identity->log_bin,
            'binlog_format' => strtoupper((string) $identity->binlog_format),
            'trust_trigger_creators' => (bool) $identity->trust_trigger_creators,
            'authenticated_account' => $account,
            'grant_scopes' => $grantScopes,
        ];
    }
}
