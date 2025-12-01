console.log("Iniciando servidor Amalgama 🚀");
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check para Railway
app.get('/', (req, res) => {
  res.status(200).send('Amalgama está vivo 🚀');
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
