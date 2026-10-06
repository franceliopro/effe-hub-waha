const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Conexão com o seu banco PostgreSQL do Coolify
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Cria a tabela de configurações automaticamente se não existir
pool.query(`
  CREATE TABLE IF NOT EXISTS hub_empresas (
    id SERIAL PRIMARY KEY,
    nome_empresa TEXT,
    waha_url TEXT,
    waha_session TEXT,
    typebot_url TEXT,
    typebot_nome_fluxo TEXT,
    cor_primaria TEXT DEFAULT '#3B82F6'
  )
`);

// 1. Rota do Painel Visual (Frontend)
app.get('/', async (req, res) => {
  // Pega a configuração da empresa 1 (Pronto para escalar para multi-empresas depois)
  const { rows } = await pool.query('SELECT * FROM hub_empresas WHERE id = 1');
  const config = rows[0] || { cor_primaria: '#3B82F6' };
  res.render('index', { config });
});

// 2. Rota para Salvar as Configurações do Painel
app.post('/salvar-config', async (req, res) => {
  const { nome_empresa, waha_url, waha_session, typebot_url, typebot_nome_fluxo, cor_primaria } = req.body;
  await pool.query(`
    INSERT INTO hub_empresas (id, nome_empresa, waha_url, waha_session, typebot_url, typebot_nome_fluxo, cor_primaria)
    VALUES (1, $1, $2, $3, $4, $5, $6)
    ON CONFLICT (id) DO UPDATE SET 
      nome_empresa = $1, waha_url = $2, waha_session = $3, typebot_url = $4, typebot_nome_fluxo = $5, cor_primaria = $6
  `, [nome_empresa, waha_url, waha_session, typebot_url, typebot_nome_fluxo, cor_primaria]);
  res.redirect('/');
});

// 3. Rota Webhook (A Mágica da Automação)
// Coloque esta URL no painel do Waha: https://seu-hub.effe.site/webhook/waha
app.post('/webhook/waha', async (req, res) => {
  res.status(200).send('OK'); // Responde rápido ao Waha

  const evento = req.body.event;
  if (evento !== 'message') return;

  const userPhone = req.body.payload.from;
  const userMessage = req.body.payload.body;

  // Busca as configurações da empresa no banco
  const { rows } = await pool.query('SELECT * FROM hub_empresas WHERE id = 1');
  if (!rows.length) return;
  const config = rows[0];

  try {
    // Passo A: Envia a mensagem do cliente para o fluxo do Typebot
    const typebotRes = await axios.post(`${config.typebot_url}/api/v1/typebots/${config.typebot_nome_fluxo}/sendMessage`, {
      message: { type: 'text', text: userMessage },
      sessionId: userPhone
    });

    // Passo B: Recebe a resposta da IA/Fluxo e manda de volta via Waha
    const mensagensDoBot = typebotRes.data.messages || [];
    for (const msg of mensagensDoBot) {
      if (msg.type === 'text') {
        await axios.post(`${config.waha_url}/api/sendText`, {
          session: config.waha_session,
          chatId: userPhone,
          text: msg.text
        });
      }
      // Aqui você pode adicionar lógica de transbordo (Handoff) para o Chatwoot
      // Ex: if (msg.text === 'FALAR_COM_HUMANO') { enviarParaChatwoot() }
    }
  } catch (error) {
    console.error("Erro na automação:", error.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Hub rodando na porta ${PORT}`));