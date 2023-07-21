// sql
const sqlite3 = require('sqlite3').verbose();

// to convert html to markdown to store in the database and send to the client
const NodeHtmlMarkdown = require("node-html-markdown");

const nhm = new NodeHtmlMarkdown.NodeHtmlMarkdown();

const fs = require('fs');

// express
const express = require('express');
// logging
const morgan = require('morgan');
const pino = require('pino')

// Apple Push Notification Service
const apn = require("@parse/node-apn");

const config = JSON.parse(fs.readFileSync('config.json', 'utf-8'))

// init APN
let apnProvider = new apn.Provider(config.apn);

// init pinio
const logger = pino({
    transport: {
        target: 'pino-pretty'
    },
})

// Navitia IDFM
const api = "https://prim.iledefrance-mobilites.fr/marketplace/navitia/coverage/fr-idf/lines?filter=(physical_mode.id=physical_mode:RapidTransit)%20or%20(physical_mode.id=physical_mode:LocalTrain)%20or%20(physical_mode.id=physical_mode:Tramway)&count=50&disable_geojson=true"

if(!config.apiKey) {
    logger.error("No navitia key (apiKey) was found in the config file")
    return process.exit(1)
}


// open the database
let db = new sqlite3.Database(config.dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        logger.error(err.message);
    }
    logger.info("Connected to the database.");
});

// check if the disruptions table exists, if not create it
db.get(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='disruptions'`,
    (err, row) => {
        if (err) {
            return logger.error(err.message);
        }
        if (!row) {
            console.log("Creating disruptions table");
            db.run(
                `CREATE TABLE disruptions (
              id TEXT PRIMARY KEY,
              status TEXT,
              line TEXT,
              start_date TEXT,
              end_date TEXT,
              severity TEXT,
              cause TEXT,
              message TEXT,
              description TEXT
              )`,
                (err) => {
                    if (err) {
                        return logger.error(err.message);
                    }
                }
            );
        }
    }
);

// check if the disruption subscriptions table exists, if not create it
db.get(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='subscriptions'`,
    (err, row) => {
        if (err) {
            return logger.error(err.message);
        }
        if (!row) {
            console.log("Creating subscriptions table");
            db.run(
                `CREATE TABLE subscriptions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              token TEXT,
              line TEXT,

              UNIQUE(token, line)
              )`,
                (err) => {
                    if (err) {
                        return logger.error(err.message);
                    }
                }
            );
        }
    }
);

function sendNotification(tokens, title, alert) {
    let notification = new apn.Notification();
    notification.topic = "fr.luclu7.PTNotificationTests";
    notification.alert = alert;
    notification.title = title;

    apnProvider.send(notification, tokens).then((result) => {
        //console.log(JSON.parse(JSON.stringify(result)))
        info = JSON.parse(JSON.stringify(result))
        info.failed.forEach(failed => {
            logger.error(failed.error)
        })

        logger.info("Sent notification to " + info.sent.length + " devices")
    });
}

function addAndSendNotification(disruption) {
    const disruption_id = disruption.id;
    const disruption_status = disruption.status;

    const disruption_linesCode = disruption.impacted_objects.map(
        (impacted_object) => {
            return impacted_object.pt_object.id;
        }
    );

    const disruption_line = Array.from(new Set(disruption_linesCode)).join(" ");

    const disruption_start_date = disruption.application_periods[0].begin;
    const disruption_end_date = disruption.application_periods.slice(-1)[0].end;

    const disruption_severity = disruption.severity.effect;
    const disruption_cause = disruption.cause;

    const disruption_message = disruption.messages.filter(
        (message) =>
        message.channel.types.filter((type) => type == "title") == "title"
    )[0].text;

    const disruption_description = disruption.messages.filter(
        (message) =>
        message.channel.types.filter((type) => type == "web") == "web"
    )[0].text;

    // check if the disruption already exists
    db.get(
        `SELECT id FROM disruptions WHERE id = ?`,
        [disruption_id],
        (err, row) => {
            if (err) {
                return logger.error(err.message);
            }

            if (!row) {
                console.log("Inserting new disruption " + disruption_id);

                // get the affected users tokens and send them a notification
                db.all(
                    `SELECT token FROM subscriptions WHERE line = ?`,
                    [disruption_line],
                    (err, rows) => {
                        if (err) {
                            return logger.error(err.message);
                        }
                        // make an array of all the tokens
                        const tokens = rows.map((row) => row.token);
                        
                        if (tokens.length == 0) return logger.info("No one is subscribed to this line")
                        // notification
                        sendNotification(tokens, "Info trafic", disruption_message)
                    }
                );


                db.run(
                    `INSERT INTO disruptions (id, status, line, start_date, end_date, severity, cause, message, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        disruption_id,
                        disruption_status,
                        disruption_line,
                        disruption_start_date,
                        disruption_end_date,
                        disruption_severity,
                        disruption_cause,
                        nhm.translate(disruption_message),
                        nhm.translate(disruption_description),
                    ],
                    function (err) {
                        if (err) {
                            return logger.error(err.message);
                        }
                        // get the last insert id
                        logger.debug(`A row has been inserted with rowid ${this.lastID}`);
                    }
                );
            }

            return row;
        }
    )
}


async function launchCycle() {
    logger.info("Fetching all the disruptions...")

    try {
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

        const disruptions = data.disruptions

        logger.info("Fetched " + disruptions.length + " disruptions")


        disruptions.forEach((disruption) => {
            addAndSendNotification(disruption)
        })

        logger.info("Done")

    } catch (err) {
        logger.error(err);
    }
}



// app config
const app = express();

// middlewares
app.use(express.json());



if (process.env.NODE_ENV == "production") {
    let accessLogStream = fs.createWriteStream('./access.log', {
        flags: 'a' // append
    });

    app.use(logger("combined", {
        stream: accessLogStream
    }));
} else {
    app.use(morgan('dev'))
}

// route to register tokens in the database
app.post('/register', (req, res) => {

    // check if both token and line are present
    if (req.body.token == null || req.body.line == null) return res.send("Error: token or line aren't present");

    let token = req.body.token;
    let line = req.body.line;



    db.run(
        `INSERT INTO subscriptions (token, line) VALUES (?, ?)`,
        [token, line],
        (err) => {
            if (err) {
                res.send("Error: " + err.message);
                return logger.error(err.message);
            }

            logger.info(`Registered on line ${line} with token ${token}`)

            res.send({
                "status": "OK",
                "message": `Registered on line ${line}`
            });
        }
    );
})

// route to unregister tokens from the database
app.post('/unregister', (req, res) => {
    let token = req.body.token;
    let line = req.body.line;

    db.run(
        `DELETE FROM subscriptions WHERE token = ? AND line = ?`,
        [token, line],
        (err) => {
            if (err) {
                res.send("Error");
                return logger.error(err.message);
            }
            res.send("OK");
        }
    );
})

// get subscriptions from token
app.get('/subscriptions/:token', (req, res) => {
    let token = req.params.token;

    db.all(
        `SELECT line FROM subscriptions WHERE token = ?`,
        [token],
        (err, rows) => {
            if (err) {
                res.send("Error");
                return logger.error(err.message);
            }
            res.send(rows.map(row => row.line));
        }
    );
})

app.get('/disruptions', (req, res) => {
    db.all(
        `SELECT
            *
        FROM
            disruptions
        INNER JOIN lines
            ON lines.id = disruptions.line;`,
        (err, rows) => {
            if (err) {
                res.send("Error");
                return logger.error(err.message);
            }
            res.send(rows);
        }
    );
})

app.get('/lines', (req, res) => {
    db.all(
        `SELECT
            *
        FROM lines
        
        WHERE
            mode = 'physical_mode:Tramway'
        OR
            mode = 'physical_mode:RapidTransit'
        OR
            mode = 'physical_mode:Metro'
        OR
            mode = 'physical_mode:LocalTrain'
        ORDER BY mode ASC`,
        (err, rows) => {
            if (err) {
                res.send("Error: " + err.message);
                return logger.error(err.message);
            }
            res.send(rows);
        }
    );
})


app.get('/disruptions/:token', (req, res) => {
    let token = req.params.token;

    db.all(
        `SELECT * FROM disruptions WHERE line IN (SELECT line FROM subscriptions WHERE token = ?)`,
        [token],
        (err, rows) => {
            if (err) {
                res.send("Error");
                return logger.error(err.message);
            }
            res.send(rows);
        }
    );
})



app.listen(config.port, config.ip,  () => console.log(`TokenGetter, listening on port ${config.port}!`));


// launch cycle every 2 minutes
let interval = setInterval(launchCycle, 2 * 60 * 1000);

launchCycle(); // first cycle at launch

// handle ctrl-c
process.on('SIGINT', () => {
    console.log("\nExiting...");
    db.close();
    clearInterval(interval);
    process.exit();
})