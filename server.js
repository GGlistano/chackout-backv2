const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { google } = require('googleapis');
const { initializeApp, cert } = require('firebase-admin/app');
const serviceAccount = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
};

initializeApp({
  credential: cert(serviceAccount),
});
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Loga as variáveis pra garantir que tão chegando no ambiente de deploy
console.log('CLIENT_ID:', process.env.CLIENT_ID ? '✔️ set' : '❌ missing');
console.log('MPESA_TOKEN:', process.env.MPESA_TOKEN ? '✔️ set' : '❌ missing');

// Função SHA256 (já tem no seu código)
function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// --- CONFIGURAÇÃO DO NODEMAILER (colocar aqui, junto das imports) ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,         // coloca seu email no .env, ex: EMAIL_USER=seu-email@gmail.com
    pass: process.env.EMAIL_PASS_APP,     // senha de app do Gmail no .env, ex: EMAIL_PASS_APP=xxxxxx
  },
});

// Função para enviar email
function enviarEmail(destino, assunto, conteudoHTML) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS_APP,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: destino,
    subject: assunto,
    html: conteudoHTML,
  };

  transporter.sendMail(mailOptions, (erro, info) => {
    if (erro) {
      console.error('❌ Erro ao enviar email:', erro);
    } else {
      console.log('📧 Email enviado com sucesso:', info.response);
    }
  });
}
async function adicionarNaPlanilha({ nome, email, phone, metodo, amount, reference,utm_source,utm_medium,utm_campaign,utm_term,utm_content }) {
  // Parse do JSON das credenciais direto da variável de ambiente
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  const spreadsheetId = '1aVQxptqsfoBnLmgury1UdiYlRGBNrwBz7s3-HC9a_bM'; // substitua pelo ID da sua planilha

  const dataAtual = new Date().toLocaleString('pt-BR', { timeZone: 'Africa/Maputo' });

  const novaLinha = [[nome, email, phone, metodo, amount, reference, dataAtual,utm_source,utm_medium,utm_campaign,utm_term,utm_content]];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: novaLinha,
    },
  });

  console.log('📊 Dados adicionados na planilha');
}
const db = getFirestore();

async function salvarCompra({ nome, email, phone, whatsapp, metodo, amount, reference, utm_source, utm_medium, utm_campaign, utm_term, utm_content }) {
  const dados = {
    nome,
    email,
    phone,
    whatsapp: whatsapp || '',
    metodo,
    amount,
    reference,
    created_at: new Date(),
    utm: {
      source: utm_source || '',
      medium: utm_medium || '',
      campaign: utm_campaign || '',
      term: utm_term || '',
      content: utm_content || '',
    },
  };

  const docRef = await db.collection('compras_checkout2').add(dados);
  console.log(`✅ Compra salva no Firebase com ID: ${docRef.id}`);
}


// Rota do pagamento
app.post('/api/pagar', async (req, res) => {
  const {
    phone, amount, reference, metodo, email, nome, pedido, whatsapp,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content
  } = req.body;

  console.log('Request body:', req.body);

  console.log('UTMs capturados:', {
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content
  });

  if (!phone || !amount || !reference || !metodo) {
    return res.status(400).json({
      status: 'error',
      message: 'phone, amount, reference e metodo são obrigatórios',
    });
  }

  let walletId, token;
  if (metodo === 'mpesa') {
    walletId = process.env.MPESA_WALLET_ID;
    token = process.env.MPESA_TOKEN;
  } else if (metodo === 'emola') {
    walletId = process.env.EMOLA_WALLET_ID;
    token = process.env.EMOLA_TOKEN;
  } else {
    return res.status(400).json({
      status: 'error',
      message: 'Método inválido. Use mpesa ou emola.',
    });
  }

  const url = `https://e2payments.explicador.co.mz/v1/c2b/${metodo}-payment/${walletId}`;

  try {
    const response = await axios.post(
      url,
      {
        client_id: process.env.CLIENT_ID,
        amount: amount.toString(),
        phone,
        reference,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Resposta da API externa:', response.data);

   
const fbPixelId = process.env.FB_PIXEL_ID;
const fbAccessToken = process.env.FB_ACCESS_TOKEN;

if (fbPixelId && fbAccessToken && email && phone) {
  try {
    const payload = {
      data: [
        {
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          user_data: {
            em: sha256(email.trim().toLowerCase()),
            ph: sha256(phone.replace(/\D/g, '')),
          },
          custom_data: {
            currency: 'MZN',
            value: amount,
          }
        }
      ],
      access_token: fbAccessToken,
      test_event_code: 'TEST95140'
    };

    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${fbPixelId}/events`,
      payload
    );

    console.log('🎯 Evento de purchase enviado pro Facebook com sucesso!');
  } catch (fbErr) {
    console.error('❌ Erro ao enviar evento pro Facebook:', fbErr.response?.data || fbErr.message);
  }
}



    // Enviar e-mail se tiver email
    const nomeCliente = nome || 'Cliente';

    if (email) {
      const textoEmailHTML = `
        <p>Olá ${nomeCliente}, seu pedido foi recebido com sucesso!</p>
        <p>Referência: ${reference}. Valor: MZN ${amount}.</p>
        <p>Obrigado pela compra!</p>
        <p>Para acessar o produto, clique no link: 
        <a href="https://club.membify.com.br/app" target="_blank">Acessar produto</a></p>
      `;

      enviarEmail(email, 'Compra Confirmada!', textoEmailHTML);
    }

    // Adicionar na planilha
    try {
      await adicionarNaPlanilha({
  nome: nomeCliente,
  email,
  phone,
  metodo,
  amount,
  reference,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_term,
  utm_content
});
    } catch (err) {
      console.error('Erro ao adicionar dados na planilha:', err);
    }
    try {
      await salvarCompra({ nome: nomeCliente, email, phone, metodo, amount, reference, utm_source, utm_medium, utm_campaign, utm_term, utm_content });
    } catch (err) {
      console.error('❌ Erro ao salvar no Firebase:', err);
    }
    try {
      const userRef = db.collection('usuarios');
      const q = await userRef.where('telefone', '==', phone).get();

      if (q.empty) {
        await userRef.add({
          nome: nomeCliente,
          telefone: phone,
          saldo: 200,
          dataCadastro: new Date(),
        });
        console.log(`📥 Novo usuário salvo em 'usuarios': ${nomeCliente}`);
      } else {
        console.log('👀 Usuário já existe na coleção "usuarios"');
      }
    } catch (err) {
      console.error('❌ Erro ao salvar usuário em "usuarios":', err);
    }
    // Enviar WhatsApp via Z-API
    try {
      const telefoneFormatado = phone.startsWith('258')
        ? phone
        : `258${phone.replace(/^0/, '')}`;

      const mensagem = `Olá ${nomeCliente}! 👋\n\nSua transação foi aprovada com sucesso 🛒\n\n📌 Referência: *${reference}*\n💰 Valor: *MZN ${amount}*\n\nAcesse seu produto clicando abaixo:\n👉 https://profound-valkyrie-c2f3cd.netlify.app\n\nSe precisar de ajuda, estamos por aqui!`;

      await axios.post(
  'https://api.z-api.io/instances/3E253C0E919CB028543B1A5333D349DF/token/4909422EC4EB52D5FAFB7AB1/send-text',
  {
    phone: telefoneFormatado,
    message: mensagem,
  },
  {
    headers: {
      'Client-Token': 'F1850a1deea6b422c9fa8baf8407628c5S',
    },
  }
);


      console.log('✅ Mensagem enviada via WhatsApp (Z-API)');
    } catch (err) {
      console.error('❌ Erro ao enviar mensagem pelo WhatsApp:', err.response?.data || err.message);
    }

    // Retorno da API
    res.json({ status: 'ok', data: response.data });
  } catch (err) {
    console.error('Erro na requisição externa:', err.response?.data || err.message);
    res.status(500).json({ status: 'error', message: err.response?.data || err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});


