import * as readline from 'readline';
import * as mysql from 'mysql';
import { exec } from 'child_process'; // kept import line because original code had it; not used now
import * as https from 'https';
import * as nodemailer from 'nodemailer';

// DB config now reads from environment variables instead of hard-coded values
const dbConfig = {
    host: process.env.DB_HOST || 'mydatabase.com',
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'secret123',
    database: process.env.DB_DATABASE || 'mydb'
};

function validateNameInput(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
        throw new Error('Name cannot be empty');
    }
    if (trimmed.length > 100) {
        throw new Error('Name too long');
    }
    // Allow letters, spaces, hyphen, apostrophe (basic name validation)
    if (!/^[\p{L}\s'-]+$/u.test(trimmed)) {
        throw new Error('Name contains invalid characters');
    }
    return trimmed;
}

function getUserInput(): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve, reject) => {
        rl.question('Enter your name: ', (answer) => {
            rl.close();
            try {
                const valid = validateNameInput(answer);
                resolve(valid);
            } catch (err) {
                reject(err);
            }
        });
    });
}

// Replaced shell-based mailing with Nodemailer to avoid command injection
function sendEmail(to: string, subject: string, body: string) {
    // Use environment variables to configure SMTP; fall back to localhost if not provided
    const smtpHost = process.env.SMTP_HOST || 'localhost';
    const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
    const smtpUser = process.env.SMTP_USER || undefined;
    const smtpPass = process.env.SMTP_PASS || undefined;

    const transportOptions: nodemailer.TransportOptions = {
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465, // true for 465, false for other ports
    };

    if (smtpUser && smtpPass) {
        transportOptions.auth = { user: smtpUser, pass: smtpPass };
    }

    const transporter = nodemailer.createTransport(transportOptions);

    // Basic minimal validation for recipient
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        console.error('Invalid recipient email address');
        return;
    }

    const mailOptions: nodemailer.SendMailOptions = {
        from: process.env.FROM_EMAIL || 'no-reply@example.com',
        to,
        subject,
        text: body
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error(`Error sending email: ${error}`);
        } else {
            console.log('Email sent:', info && info.messageId ? info.messageId : '[info unavailable]');
        }
    });
}

// Use https and validate/parse the returned data before returning
function getData(): Promise<string> {
    return new Promise((resolve, reject) => {
        // Accept API URL from env or fall back to original host (but require https)
        const apiUrl = process.env.API_URL || 'https://insecure-api.com/get-data';
        let url: URL;
        try {
            url = new URL(apiUrl);
        } catch (err) {
            return reject(new Error('Invalid API_URL'));
        }

        if (url.protocol !== 'https:') {
            return reject(new Error('Insecure protocol: API URL must use HTTPS'));
        }

        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                // Try to parse JSON and validate shape/length
                try {
                    const parsed = JSON.parse(data);

                    // If API returns a plain string
                    if (typeof parsed === 'string') {
                        const val = parsed.trim();
                        if (val.length === 0 || val.length > 2000) {
                            return reject(new Error('API returned invalid string length'));
                        }
                        return resolve(val);
                    }

                    // If API returns an object: expect a `value` string field (adjust if needed)
                    if (typeof parsed === 'object' && parsed !== null) {
                        const candidate = (parsed as any).value;
                        if (typeof candidate !== 'string') {
                            return reject(new Error('API returned unexpected JSON shape (missing "value" string)'));
                        }
                        const val = candidate.trim();
                        if (val.length === 0 || val.length > 2000) {
                            return reject(new Error('API returned invalid "value" length'));
                        }
                        return resolve(val);
                    }

                    return reject(new Error('API returned unexpected data type'));
                } catch (err) {
                    return reject(new Error('Failed to parse API response as JSON'));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

// Use parameterized queries to avoid SQL injection; otherwise keep same flow
function saveToDb(data: string) {
    const connection = mysql.createConnection(dbConfig);
    // parameterized query instead of string concatenation
    const query = 'INSERT INTO mytable (column1, column2) VALUES (?, ?)';
    const values = [data, 'Another Value'];

    connection.connect();
    connection.query(query, values, (error, results) => {
        if (error) {
            console.error('Error executing query:', error);
        } else {
            console.log('Data saved');
        }
        connection.end();
    });
}

(async () => {
    try {
        const userInput = await getUserInput();
        const data = await getData();
        saveToDb(data);
        sendEmail('admin@example.com', 'User Input', userInput);
    } catch (err) {
        console.error('Error:', (err as Error).message);
        process.exit(1);
    }
})();
