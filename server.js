console.log("Iniciando servidor Amalgama 🚀");

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de conexión a PostgreSQL en Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // necesario en Railway
  }
});

// Health check para Railway
app.get('/', (req, res) => {
  res.send('Ok');
});

// Endpoint de prueba de BD
app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW() as fecha');
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error en la BD:', err);
    res.status(500).send('Error en la conexión a la BD');
  }
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
