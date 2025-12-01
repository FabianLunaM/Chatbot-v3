console.log("Iniciando servidor Amalgama 🚀");
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check para Railway
//app.get('/', (req, res) => {
//  res.send('Amalgama está vivo 🚀');
//});
console.log("servidor Amalgama 🚀");
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
