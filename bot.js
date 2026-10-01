// bot.js — Dopros Trainer v4 (мини-RAG, жёсткие ограничения языка)
const { Bot, InlineKeyboard } = require('grammy');
const OpenAI = require('openai');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============ CONFIG ============
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';

if (!BOT_TOKEN) { console.error('TELEGRAM_BOT_TOKEN missing'); process.exit(1); }
if (!OPENROUTER_KEY) { console.error('OPENROUTER_API_KEY missing'); process.exit(1); }

const ai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// ============ LOAD LAWS ============
function loadLaws(jur) {
  try {
    const filePath = path.join(__dirname, `laws_${jur}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data.articles || [];
  } catch (e) {
    console.error(`Failed to load laws_${jur}.json:`, e.message);
    return [];
  }
}

const LAWS = {
  KZ: loadLaws('KZ'),
  RU: loadLaws('RU'),
  DE: loadLaws('DE')
};

console.log('📚 Laws loaded:', {
  KZ: LAWS.KZ.length,
  RU: LAWS.RU.length,
  DE: LAWS.DE.length
});

// ============ MINI-RAG ============
function findRelevantArticles(jur, query, limit = 5) {
  const articles = LAWS[jur] || [];
  if (!articles.length) return [];

  const queryLower = query.toLowerCase();
  const queryWords = queryLower
    .replace(/[^\w\sа-яёäöüß]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3);

  const scored = articles.map(art => {
    let score = 0;
    for (const kw of art.keywords) {
      const kwLower = kw.toLowerCase();
      if (queryLower.includes(kwLower)) score += 3;
      for (const qw of queryWords) {
        if (kwLower.includes(qw) || qw.includes(kwLower)) score += 1;
      }
    }
    return { art, score };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.art);
}

// ============ STATUS ============
const STATUS = {
  witness:    { ru: 'Свидетель',    de: 'Zeuge' },
  suspect:    { ru: 'Подозреваемый', de: 'Beschuldigter' },
  accused:    { ru: 'Обвиняемый',   de: 'Angeklagter' },
  victim:     { ru: 'Потерпевший',  de: 'Geschädigter' },
  plaintiff:  { ru: 'Истец',        de: 'Kläger' },
  defendant:  { ru: 'Ответчик',     de: 'Beklagter' }
};

const JUR = {
  KZ: { name: 'Казахстан',   lang: 'ru' },
  RU: { name: 'Россия',      lang: 'ru' },
  DE: { name: 'Deutschland', lang: 'de' }
};

// ============ LANGUAGE GUARD ============
// Проверяет ответ AI: если много английских символов в русской юрисдикции — режем
function detectLanguage(text) {
  const latinCount = (text.match(/[a-zA-Z]/g) || []).length;
  const cyrillicCount = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
  const total = latinCount + cyrillicCount;
  if (total === 0) return 'unknown';
  return latinCount > cyrillicCount ? 'latin' : 'cyrillic';
}

function enforceLanguage(text, expectedLang) {
  const detected = detectLanguage(text);
  // Если ожидается русский, но ответ латиницей — вернуть null
  if (expectedLang === 'ru' && detected === 'latin') return null;
  if (expectedLang === 'de' && detected === 'cyrillic') return null;
  return text;
}

// ============ BUILD LAWS CONTEXT ============
function buildLawsContext(jur, articles) {
  if (!articles.length) {
    return '(нет найденных статей / keine Artikel gefunden)';
  }
  return articles.map(a => `\n### ${a.title}\n${a.text}\n`).join('\n');
}

// ============ QUESTION PROMPT ============
function buildQuestionPrompt(jur, status, lang, incident, history, relevantLaws) {
  const statusText = lang === 'de' ? STATUS[status].de : STATUS[status].ru;
  const lawsContext = buildLawsContext(jur, relevantLaws);

  if (lang === 'de') {
    return `⚠️ PFLICHT: Antworte AUSSCHLIESSLICH auf DEUTSCH.
⚠️ VERBOTEN: Englisch, Russisch, jede andere Sprache.
⚠️ VERBOTEN: Analyse, Bewertung, Kommentare, dein Denken zeigen.
⚠️ NUR EINE FRAGE.

Du bist Ermittler in einem Verhör in ${JUR[jur].name}.
Status: ${statusText}.

VORFALL:
${incident}

DIALOG:
${history}

GESETZE:
${lawsContext}

FORMAT (exakt einhalten):
🎭 Ermittler: [eine Frage auf Deutsch]

DEINE ANTWORT BESTEHT NUR AUS DIESEM FORMAT. KEIN TEXT DAVOR ODER DANACH.`;
  }

  return `⚠️ ОБЯЗАТЕЛЬНО: отвечай ТОЛЬКО на РУССКОМ языке.
⚠️ ЗАПРЕЩЕНО: английский, немецкий, любой другой язык.
⚠️ ЗАПРЕЩЕНО: анализ, оценка, комментарии, показ рассуждений.
⚠️ ТОЛЬКО ОДИН ВОПРОС.

Ты — следователь на допросе в ${JUR[jur].name}.
Статус: ${statusText}.

ИНЦИДЕНТ:
${incident}

ДИАЛОГ:
${history}

СТАТЬИ:
${lawsContext}

ФОРМАТ (строго):
🎭 Следователь: [один вопрос на русском]

ТВОЙ ОТВЕТ — ТОЛЬКО ЭТОТ ФОРМАТ. НИКАКОГО ТЕКСТА ДО ИЛИ ПОСЛЕ.`;
}

// ============ EVALUATION PROMPT ============
function buildEvaluationPrompt(jur, status, lang, incident, history, relevantLaws) {
  const statusText = lang === 'de' ? STATUS[status].de : STATUS[status].ru;
  const lawsContext = buildLawsContext(jur, relevantLaws);

  if (lang === 'de') {
    return `⚠️ PFLICHT: Antworte AUSSCHLIESSLICH auf DEUTSCH.
⚠️ VERBOTEN: Englisch, Russisch, jede andere Sprache.
⚠️ VERBOTEN: Analyse der Rolle, Denken zeigen, "The user...".
⚠️ NUR das Format unten.

Du bist Trainer-Anwalt.
Status: ${statusText}.

VORFALL:
${incident}

DIALOG:
${history}

GESETZE:
${lawsContext}

FORMAT (exakt einhalten):

📊 Bewertung: [✅ / ⚠️ / ❌]

⚠️ Fehler: [1 Satz oder "keine"]

🎯 Etalon: «[korrekte Formulierung]»

📚 Artikel: [genaue Titel aus GESETZE]

💬 Kurz: [1-2 Sätze]

DEINE ANTWORT BESTEHT NUR AUS DIESEM FORMAT. KEIN TEXT DAVOR ODER DANACH.`;
  }

  return `⚠️ ОБЯЗАТЕЛЬНО: отвечай ТОЛЬКО на РУССКОМ языке.
⚠️ ЗАПРЕЩЕНО: английский, немецкий, любой другой язык.
⚠️ ЗАПРЕЩЕНО: анализ роли, показ рассуждений, "The user...".
⚠️ ТОЛЬКО формат ниже.

Ты — тренер-адвокат.
Статус: ${statusText}.

ИНЦИДЕНТ:
${incident}

ДИАЛОГ:
${history}

СТАТЬИ:
${lawsContext}

ФОРМАТ (строго):

📊 Оценка: [✅ / ⚠️ / ❌]

⚠️ Ошибка: [1 предложение или "нет"]

🎯 Эталон: «[правильная формулировка]»

📚 Статьи: [точные названия из СТАТЬИ]

💬 Коротко: [1-2 предложения]

ТВОЙ ОТВЕТ — ТОЛЬКО ЭТОТ ФОРМАТ. НИКАКОГО ТЕКСТА ДО ИЛИ ПОСЛЕ.`;
}

// ============ HINT PROMPT ============
function buildHintPrompt(jur, status, lang, incident, history, relevantLaws) {
  const statusText = lang === 'de' ? STATUS[status].de : STATUS[status].ru;
  const lawsContext = buildLawsContext(jur, relevantLaws);

  if (lang === 'de') {
    return `⚠️ NUR DEUTSCH. Max 2 Sätze. KEINE Analyse.

Status: ${statusText}.
VORFALL: ${incident}
DIALOG: ${history}

GESETZE:
${lawsContext}

FORMAT:
💡 Hinweis: [max 2 Sätze auf Deutsch]`;
  }

  return `⚠️ ТОЛЬКО РУССКИЙ. Максимум 2 предложения. БЕЗ анализа.

Статус: ${statusText}.
ИНЦИДЕНТ: ${incident}
ДИАЛОГ: ${history}

СТАТЬИ:
${lawsContext}

ФОРМАТ:
💡 Подсказка: [максимум 2 предложения на русском]`;
}

// ============ SESSIONS ============
const sessions = new Map();

// ============ BOT ============
const bot = new Bot(BOT_TOKEN);
bot.catch((err) => console.error('Bot error:', err));

// ============ AI CALL WRAPPER with retry ============
async function callAI(prompt, maxTokens, expectedLang) {
  const response = await ai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.6,
    max_tokens: maxTokens
  });

  let text = response.choices[0].message.content || '';

  // Проверка языка
  const langOk = enforceLanguage(text, expectedLang);
  if (!langOk) {
    // Повторный запрос с ещё более жёстким требованием
    console.warn(`⚠️ Language violation detected. Retrying...`);
    const retryResponse = await ai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: text },
        {
          role: 'user',
          content: expectedLang === 'de'
            ? 'FALSCH! Antworte NUR auf Deutsch. Kein Englisch. Nur das Format.'
            : 'НЕВЕРНО! Отвечай ТОЛЬКО на русском. Никакого английского. Только формат.'
        }
      ],
      temperature: 0.3,
      max_tokens: maxTokens
    });
    text = retryResponse.choices[0].message.content || '';
  }

  return text;
}

// ============ /start ============
bot.command('start', async (ctx) => {
  sessions.delete(ctx.from.id);

  const kb = new InlineKeyboard()
    .text('🇰🇿 Казахстан', 'jur:KZ').row()
    .text('🇷🇺 Россия', 'jur:RU').row()
    .text('🇩🇪 Deutschland', 'jur:DE');

  await ctx.reply(
    '⚖️ *Тренажёр допроса / Verhör-Trainer*\n\n' +
    '⚠️ Это тренажёр, не замена адвоката.\n\n' +
    'Выберите юрисдикцию / Wählen Sie die Jurisdiktion:',
    { parse_mode: 'Markdown', reply_markup: kb }
  );
});

// ============ JURISDICTION ============
bot.callbackQuery(/^jur:(KZ|RU|DE)$/, async (ctx) => {
  const jur = ctx.match[1];
  sessions.set(ctx.from.id, {
    jur, mode: null, status: null, incident: null, history: []
  });

  await ctx.answerCallbackQuery();

  const isDE = jur === 'DE';
  const kb = new InlineKeyboard()
    .text(isDE ? '🎓 Anfänger' : '🎓 Новичок', 'mode:beginner').row()
    .text(isDE ? '📝 Prüfung' : '📝 Экзамен', 'mode:exam');

  await ctx.reply(
    isDE
      ? '🎓 *Anfänger* — mit Hinweisen.\n📝 *Prüfung* — ohne Hinweise.\n\nWählen Sie den Modus:'
      : '🎓 *Новичок* — с подсказками.\n📝 *Экзамен* — без подсказок.\n\nВыберите режим:',
    { parse_mode: 'Markdown', reply_markup: kb }
  );
});

// ============ MODE ============
bot.callbackQuery(/^mode:(beginner|exam)$/, async (ctx) => {
  const mode = ctx.match[1];
  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.answerCallbackQuery({ text: 'Начните с /start' });

  sess.mode = mode;
  await ctx.answerCallbackQuery();

  const isDE = sess.jur === 'DE';
  const kb = new InlineKeyboard();

  if (isDE) {
    kb.text('👤 Zeuge', 'st:witness').row()
      .text('🚨 Beschuldigter', 'st:suspect').row()
      .text('⚖️ Angeklagter', 'st:accused').row()
      .text('🛡️ Geschädigter', 'st:victim').row()
      .text('📋 Kläger', 'st:plaintiff').row()
      .text('📋 Beklagter', 'st:defendant');
  } else {
    kb.text('👤 Свидетель', 'st:witness').row()
      .text('🚨 Подозреваемый', 'st:suspect').row()
      .text('⚖️ Обвиняемый', 'st:accused').row()
      .text('🛡️ Потерпевший', 'st:victim').row()
      .text('📋 Истец', 'st:plaintiff').row()
      .text('📋 Ответчик', 'st:defendant');
  }

  await ctx.reply(
    isDE ? '*Wählen Sie Ihren Verfahrensstatus:*' : '*Выберите свой процессуальный статус:*',
    { parse_mode: 'Markdown', reply_markup: kb }
  );
});

// ============ STATUS ============
bot.callbackQuery(/^st:(witness|suspect|accused|victim|plaintiff|defendant)$/, async (ctx) => {
  const status = ctx.match[1];
  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.answerCallbackQuery({ text: 'Начните с /start' });

  sess.status = status;
  await ctx.answerCallbackQuery();

  const isDE = sess.jur === 'DE';
  const statusText = isDE ? STATUS[status].de : STATUS[status].ru;

  await ctx.reply(
    isDE
      ? `*${statusText}*\n\n*Beschreiben Sie Ihren Vorfall ausführlich:*\n\n• Was ist passiert?\n• Wann?\n• Wer war beteiligt?\n• Was haben Sie getan?\n\n⚠️ Keine persönlichen Daten.`
      : `*${statusText}*\n\n*Опишите подробно свой инцидент:*\n\n• Что произошло?\n• Когда?\n• Кто участвовал?\n• Что делали вы?\n\n⚠️ Без личных данных.`,
    { parse_mode: 'Markdown' }
  );
});

// ============ /reset ============
bot.command('reset', async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply('Сброшено. / Zurückgesetzt.\n\nНапишите /start.');
});

// ============ /help ============
bot.command('help', async (ctx) => {
  await ctx.reply(
    '⚖️ *Тренажёр допроса*\n\n' +
    '• /start — начать\n' +
    '• /reset — сбросить\n' +
    '• /finish — итог тренировки\n' +
    '• /help — справка\n\n' +
    '📚 Используются статьи из официальных источников.',
    { parse_mode: 'Markdown' }
  );
});

// ============ /finish ============
bot.command('finish', async (ctx) => {
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) {
    return ctx.reply('Нет активной сессии. / Keine aktive Sitzung.');
  }

  const isDE = sess.jur === 'DE';
  const expectedLang = isDE ? 'de' : 'ru';

  const allText = sess.incident + ' ' + sess.history.map(m => m.content).join(' ');
  const relevant = findRelevantArticles(sess.jur, allText, 5);

  const summaryPrompt = isDE
    ? `⚠️ NUR DEUTSCH. Fasse die Trainingssitzung zusammen: Stärken, Schwächen, was zu wiederholen. Kurz.

VORFALL: ${sess.incident}
DIALOG: ${sess.history.map(m => m.content).join('\n\n')}

GESETZE:
${buildLawsContext(sess.jur, relevant)}`
    : `⚠️ ТОЛЬКО РУССКИЙ. Подведи итог тренировки: сильные стороны, слабые, что повторить. Кратко.

ИНЦИДЕНТ: ${sess.incident}
ДИАЛОГ: ${sess.history.map(m => m.content).join('\n\n')}

СТАТЬИ:
${buildLawsContext(sess.jur, relevant)}`;

  try {
    await ctx.replyWithChatAction('typing');
    const answer = await callAI(summaryPrompt, 1200, expectedLang);
    const title = isDE ? '🎓 *AUSWERTUNG*\n\n' : '🎓 *ИТОГ*\n\n';
    await ctx.reply(title + answer, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка. / Fehler.');
  }
});

// ============ HINT ============
bot.callbackQuery('hint', async (ctx) => {
  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.answerCallbackQuery({ text: 'Начните с /start' });
  if (sess.mode === 'exam') {
    return ctx.answerCallbackQuery({ text: 'В режиме экзамена подсказки отключены', show_alert: true });
  }

  await ctx.answerCallbackQuery();

  const isDE = sess.jur === 'DE';
  const expectedLang = isDE ? 'de' : 'ru';
  const lastQuestion = sess.history.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
  const query = sess.incident + ' ' + lastQuestion;
  const relevant = findRelevantArticles(sess.jur, query, 3);
  const histText = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🤖 ') + m.content).join('\n\n');

  try {
    await ctx.replyWithChatAction('typing');
    const answer = await callAI(
      buildHintPrompt(sess.jur, sess.status, expectedLang, sess.incident, histText, relevant),
      300,
      expectedLang
    );
    await ctx.reply(answer, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка подсказки.');
  }
});

// ============ MAIN ============
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  const userId = ctx.from.id;
  const sess = sessions.get(userId);

  if (!sess) return ctx.reply('Начните с /start');
  if (!sess.jur) return ctx.reply('Выберите юрисдикцию: /start');
  if (!sess.mode) return ctx.reply('Выберите режим: /start');
  if (!sess.status) return ctx.reply('Выберите статус: /start');

  const isDE = sess.jur === 'DE';
  const expectedLang = isDE ? 'de' : 'ru';

  // ========== ПЕРВЫЙ ИНЦИДЕНТ ==========
  if (!sess.incident) {
    sess.incident = text;
    sess.history = [{ role: 'user', content: (isDE ? 'Vorfall: ' : 'Инцидент: ') + text }];

    await ctx.reply(isDE ? '⏳ Erste Frage wird vorbereitet...' : '⏳ Готовлю первый вопрос...');

    const relevant = findRelevantArticles(sess.jur, text, 5);
    console.log(`🔍 RAG: найдено ${relevant.length} статей`);

    try {
      await ctx.replyWithChatAction('typing');
      const histText = sess.history.map(m => m.content).join('\n\n');
      const question = await callAI(
        buildQuestionPrompt(sess.jur, sess.status, expectedLang, sess.incident, histText, relevant),
        500,
        expectedLang
      );
      sess.history.push({ role: 'assistant', content: question });

      const kb = new InlineKeyboard();
      if (sess.mode === 'beginner') {
        kb.text(isDE ? '💡 Hinweis' : '💡 Подсказка', 'hint').row();
      }
      kb.text(isDE ? '🎓 Training beenden' : '🎓 Завершить тренировку', 'finish_action');

      await ctx.reply(question, { parse_mode: 'Markdown', reply_markup: kb });
    } catch (e) {
      console.error('AI error:', e);
      await ctx.reply('Ошибка ИИ. / KI-Fehler.');
    }
    return;
  }

  // ========== ОТВЕТ ПОЛЬЗОВАТЕЛЯ ==========
  sess.history.push({ role: 'user', content: text });

  await ctx.reply(isDE ? '⏳ Analyse läuft...' : '⏳ Анализирую ответ...');

  const lastQuestion = sess.history.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
  const query = lastQuestion + ' ' + text;
  const relevant = findRelevantArticles(sess.jur, query, 5);
  console.log(`🔍 RAG: найдено ${relevant.length} статей для оценки`);

  try {
    await ctx.replyWithChatAction('typing');
    const histText = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n');

    // 1) Разбор
    const evaluation = await callAI(
      buildEvaluationPrompt(sess.jur, sess.status, expectedLang, sess.incident, histText, relevant),
      700,
      expectedLang
    );
    await ctx.reply(evaluation, { parse_mode: 'Markdown' });

    // 2) Следующий вопрос
    const allText = sess.incident + ' ' + sess.history.map(m => m.content).join(' ');
    const nextRelevant = findRelevantArticles(sess.jur, allText, 5);

    await ctx.replyWithChatAction('typing');
    const histText2 = histText + '\n\n📊 Оценка была дана.';
    const nextQuestion = await callAI(
      buildQuestionPrompt(sess.jur, sess.status, expectedLang, sess.incident, histText2, nextRelevant),
      500,
      expectedLang
    );
    sess.history.push({ role: 'assistant', content: nextQuestion });

    const kb = new InlineKeyboard();
    if (sess.mode === 'beginner') {
      kb.text(isDE ? '💡 Hinweis' : '💡 Подсказка', 'hint').row();
    }
    kb.text(isDE ? '🎓 Training beenden' : '🎓 Завершить тренировку', 'finish_action');

    await ctx.reply(nextQuestion, { parse_mode: 'Markdown', reply_markup: kb });

  } catch (e) {
    console.error('AI error:', e);
    await ctx.reply('Ошибка ИИ. / KI-Fehler.');
  }
});

// ============ FINISH ACTION ============
bot.callbackQuery('finish_action', async (ctx) => {
  await ctx.answerCallbackQuery();
  const sess = sessions.get(ctx.from.id);
  const isDE = sess?.jur === 'DE';
  await ctx.reply(isDE ? 'Senden Sie /finish für die Auswertung.' : 'Отправьте /finish для итоговой оценки.');
});

// ============ START ============
bot.start({ drop_pending_updates: true });
console.log('🚀 Dopros Trainer v4 (жёсткие ограничения языка) started');

const httpApp = express();
httpApp.get('/', (req, res) => res.send('Dopros Trainer v4 running'));
const PORT = process.env.PORT || 3000;
httpApp.listen(PORT, () => console.log('HTTP server on port ' + PORT));
