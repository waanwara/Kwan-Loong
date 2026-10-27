const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const seedEmployees = require('../../employees');
const seedFuelModels = require('../data/rothermelFuelModels');

const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, '../../data/kwanlong.sqlite');
const dbDir = path.dirname(dbPath);

let db;

function getDatabase() {
    if (!db) {
        fs.mkdirSync(dbDir, { recursive: true });
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
    }

    return db;
}

function initializeDatabase() {
    const database = getDatabase();

    database.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'operator',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS fuel_models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            parameters_json TEXT NOT NULL,
            source TEXT,
            version TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS weather_observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            wind_speed_kmh REAL NOT NULL,
            wind_direction_deg REAL,
            temperature_c REAL,
            relative_humidity REAL,
            observed_at TEXT NOT NULL,
            source TEXT,
            raw_payload_json TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS terrain_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            slope_percent REAL NOT NULL,
            aspect_deg REAL,
            elevation_m REAL,
            source TEXT,
            raw_payload_json TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS fire_scenarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_by INTEGER,
            fuel_model_id TEXT,
            latitude REAL,
            longitude REAL,
            weather_observation_id INTEGER,
            terrain_sample_id INTEGER,
            input_json TEXT NOT NULL,
            estimate_json TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (fuel_model_id) REFERENCES fuel_models(id),
            FOREIGN KEY (weather_observation_id) REFERENCES weather_observations(id),
            FOREIGN KEY (terrain_sample_id) REFERENCES terrain_samples(id)
        );

        CREATE TABLE IF NOT EXISTS dispatch_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id INTEGER,
            action TEXT NOT NULL,
            payload_json TEXT,
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (scenario_id) REFERENCES fire_scenarios(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        );
    `);

    seedUsers(database);
    seedFuelModelsTable(database);
}

function seedUsers(database) {
    const insertUser = database.prepare(`
        INSERT INTO users (id, email, password_hash, name)
        VALUES (@id, @email, @passwordHash, @name)
        ON CONFLICT(id) DO UPDATE SET
            email = excluded.email,
            password_hash = excluded.password_hash,
            name = excluded.name,
            updated_at = CURRENT_TIMESTAMP
    `);

    const insertMany = database.transaction((users) => {
        users.forEach(user => insertUser.run(user));
    });

    insertMany(seedEmployees);
}

function seedFuelModelsTable(database) {
    const insertFuelModel = database.prepare(`
        INSERT INTO fuel_models (id, name, category, parameters_json, source, version)
        VALUES (@id, @name, @category, @parametersJson, @source, @version)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            parameters_json = excluded.parameters_json,
            source = excluded.source,
            version = excluded.version,
            updated_at = CURRENT_TIMESTAMP
    `);

    const insertMany = database.transaction((models) => {
        models.forEach(model => insertFuelModel.run({
            id: model.id,
            name: model.name,
            category: model.category,
            parametersJson: JSON.stringify({
                description: model.description,
                typicalFuelLoadKgM2: model.typicalFuelLoadKgM2
            }),
            source: 'seed-placeholder',
            version: '0.1'
        }));
    });

    insertMany(seedFuelModels);
}

function findUserByEmail(email) {
    return getDatabase()
        .prepare('SELECT id, email, password_hash AS passwordHash, name, role FROM users WHERE lower(email) = lower(?)')
        .get(email);
}

function findUserById(id) {
    return getDatabase()
        .prepare('SELECT id, email, password_hash AS passwordHash, name, role FROM users WHERE id = ?')
        .get(id);
}

function mapFuelModelRow(row) {
    if (!row) return null;

    const parameters = JSON.parse(row.parametersJson);
    return {
        id: row.id,
        name: row.name,
        category: row.category,
        description: parameters.description,
        typicalFuelLoadKgM2: parameters.typicalFuelLoadKgM2,
        source: row.source,
        version: row.version
    };
}

function listFuelModels() {
    return getDatabase()
        .prepare(`
            SELECT id, name, category, parameters_json AS parametersJson, source, version
            FROM fuel_models
            ORDER BY id
        `)
        .all()
        .map(mapFuelModelRow);
}

function findFuelModelById(id) {
    return mapFuelModelRow(
        getDatabase()
            .prepare(`
                SELECT id, name, category, parameters_json AS parametersJson, source, version
                FROM fuel_models
                WHERE id = ?
            `)
            .get(id)
    );
}

function saveFireScenario({ createdBy, scenario, estimate }) {
    const result = getDatabase()
        .prepare(`
            INSERT INTO fire_scenarios (
                created_by,
                fuel_model_id,
                latitude,
                longitude,
                input_json,
                estimate_json
            )
            VALUES (@createdBy, @fuelModelId, @latitude, @longitude, @inputJson, @estimateJson)
        `)
        .run({
            createdBy,
            fuelModelId: scenario.fuelModel.id,
            latitude: scenario.latitude,
            longitude: scenario.longitude,
            inputJson: JSON.stringify(scenario),
            estimateJson: JSON.stringify(estimate)
        });

    return result.lastInsertRowid;
}

module.exports = {
    dbPath,
    findFuelModelById,
    findUserByEmail,
    findUserById,
    getDatabase,
    initializeDatabase,
    listFuelModels,
    saveFireScenario
};
