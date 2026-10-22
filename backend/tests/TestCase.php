<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    public function createApplication()
    {
        $app = parent::createApplication();
        $connection = $app['config']->get('database.default');
        $database = $app['config']->get('database.connections.mysql');

        if (
            $connection !== 'mysql'
            || ($database['database'] ?? null) !== 'hadirinaja_test'
            || ! in_array($database['host'] ?? null, ['127.0.0.1', 'localhost'], true)
            || (string) ($database['port'] ?? '') !== '3306'
            || filled($database['url'] ?? null)
        ) {
            throw new RuntimeException('Laravel tests may only use the isolated local hadirinaja_test MySQL database.');
        }

        return $app;
    }
}
