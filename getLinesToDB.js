const fs = require('fs');
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'))


const sqlite3 = require("sqlite3").verbose();
// open the database
let db = new sqlite3.Database(config.dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log("Connected to the database.");
});

// check if the lines table exists, if not create it
db.get(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='lines'`,
    (err, row) => {
        if (err) {
            return console.error(err.message);
        }
        if (!row) {
            console.log("Creating lines table");
            db.run(
                `CREATE TABLE lines (
              id TEXT UNIQUE PRIMARY KEY,
              name TEXT,
              description TEXT,
              mode TEXT,
              color TEXT,
              text_color TEXT
              )`,
                (err) => {
                    if (err) {
                        return console.error(err.message);
                    }
                }
            );
        }
    }
);

const api = "https://prim.iledefrance-mobilites.fr/marketplace/navitia/coverage/fr-idf/lines?disable_disruption=true&disable_geojson=true&count=2000"


async function myFunction() {
    const data = await fetch(api, {
            method: "GET",
            headers: {
                apiKey: config.apiKey,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
        })
        .then((response) => response.json())
        .catch((err) => {
            console.log(err);
        });

    const lines = data.lines;

    console.log(`Adding ${lines.length} lines to the db`)

    for (const lineInt in lines) {

        const line = lines[lineInt]

        const id = line.id
        const name = line.code

        const mode = line.physical_modes && line.physical_modes.length > 0 ? line.physical_modes[0].id : null

        //const code = line.codes ? line.codes.filter(e => e.type == "source")[0].value : null
        const description = line.name
        const color = line.color
        const text_color = line.text_color

        console.log(`Currently adding line ${name}...`)

        db.run(
            `INSERT INTO lines (id, name, description, mode, color, text_color) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, name, description, mode, color, text_color],
            function (err) {
                if (err) {
                    return console.log(err.message);
                }
                // get the last insert id
                console.log(`A row has been inserted with rowid ${this.lastID}`);
            }
        );


    };



    db.all(`SELECT COUNT(*) FROM lines`, [], (err, rows) => {
        if (err) {
            throw err;
        }
        rows.forEach((row) => {
            console.log(row);
        });
    })

}

myFunction();