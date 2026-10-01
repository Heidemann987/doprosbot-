// bot.js — Dopros Trainer v3 (мини-RAG: KZ, RU, DE)
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

// ============ MINI-RAG SEARCH ============
// Простой поиск: сколько ключевых слов из запроса встречается в keywords статьи
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

// ============ BUILD CONTEXT FROM RAG ============
function buildLawsContext(jur, articles) {
  if (!articles.length) {
    return '(keine spezifischen Artikel gefunden / статьи не найдены)';
  }
  return articles.map(a =>
    `\n### ${a.title}\n${a.text}\n`
  ).join('\n');
}

// ============ QUESTION PROMPT ============
function buildQuestionPrompt(jur, status, lang, incident, history, relevantLaws) {
  const statusText = lang === 'de' ? STATUS[status].de : STATUS[status].ru;
  const lawsContext = buildLawsContext(jur, relevantLaws);

  if (lang === 'de') {
    return `Du bist Ermittler in einem Verhör in ${JUR[jur].name}. Verfahrensstatus: ${statusText}.

VORFALL:
${incident}

BISHERIGER DIALOG:
${history}

RELEVANTE GESETZE (nutze NUR diese):
${lawsContext}

DEINE AUFGABE: Stelle die NÄCHSTE Frage als Ermittler. NUR die Frage — keine Analyse, kein Kommentar.

FORMAT:
🎭 Ermittler: [Frage auf Deutsch]

REGELN:
- Nur EINE Frage.
- Auf Deutsch.
- Ohne Analyse, ohne Bewertung.
- Realistisch, passend zum Status "${statusText}".`;
  }

  return `Ты — следователь на допросе в ${JUR[jur].name}. Процессуальный статус: ${statusText}.

ИНЦИДЕНТ:
${incident}

ПРЕДЫДУЩИЙ ДИАЛОГ:
${history}

РЕЛЕВАНТНЫЕ СТАТЬИ (используй ТОЛЬКО эти):
${lawsContext}

ТВОЯ ЗАДАЧА: задать СЛЕДУЮЩИЙ вопрос как следователь. ТОЛЬКО вопрос — без анализа.

ФОРМАТ:
🎭 Следователь: [вопрос на русском]

ПРАВИЛА:
- Только ОДИН вопрос.
- На русском.
- Без анализа, без оценки.
- Реалистично, под статус "${statusText}".`;
}

// ============ EVALUATION PROMPT ============
function buildEvaluationPrompt(jur, status, lang, incident, history, relevantLaws) {
  const statusText = lang === 'de' ? STATUS[status].de : STATUS[status].ru;
  const lawsContext = buildLawsContext(jur, relevantLaws);

  if (lang === 'de') {
    return `Du bist Trainer-Anwalt. Bewerte die letzte Antwort des Nutzers.

Status: ${statusText}.

VORFALL:
${incident}

DIALOG:
${history}

RELEVANTE GESETZE (zitiere NUR diese):
${lawsContext}

FORMAT:

📊 Bewertung: [✅ / ⚠️ / ❌]

⚠️ Fehler: [was falsch war — oder "keine"]

🎯 Etalon: [korrekte Formulierung]

📚 Artikel: [genaue Titel der Artikel oben]

💬 Kurz: [1-2 Sätze]

REGELN:
- Bewerte nur die LETZTE Antwort.
- Zitiere NUR Artikel aus der Liste oben.
- Auf Deutsch.`;
  }

  return `Ты — тренер-адвокат. Оцени последний ответ пользователя.

Статус: ${statusText}.

ИНЦИДЕНТ:
${incident}

ДИАЛОГ:
${history}

РЕЛЕВАНТНЫЕ СТАТЬИ (цитируй ТОЛЬКО эти):
${lawsContext}

ФОРМАТ:

📊 Оценка: [✅ / ⚠️ / ❌]

⚠️ Ошибка: [что не так — или "нет"]

🎯 Эталон: [правильная формулировка]

📚 Статьи: [точные заголовки из списка выше]

💬 Коротко: [1-2 предложения]

ПРАВИЛА:
- Оценивай только ПОСЛЕДНИЙ ответ.
- Цитируй ТОЛЬКО статьи из списка выше.
- На русском.`;
}

// ============ HINT PROMPT ============
function buildHintPrompt(jur, status, lang, incident, history, relevantLaws) {
  const statusText = lang === 'de' ? STATUS[status].de : STATUS[status].ru;
  const lawsContext = buildLawsContext(jur, relevantLaws);

  if (lang === 'de') {
    return `Du bist Trainer-Anwalt. Der Nutzer bittet um einen HINWEIS.

Status: ${statusText}.
VORFALL: ${incident}
DIALOG: ${history}

RELEVANTE GESETZE:
${lawsContext}

Gib 1-2 Sätze Hinweis — NICHT die komplette Antwort.

FORMAT:
💡 Hinweis: [kurz, unter 300 Zeichen]

Auf Deutsch.`;
  }

  return `Ты — тренер-адвокат. Пользователь просит ПОДСКАЗКУ.

Статус: ${statusText}.
ИНЦИДЕНТ: ${incident}
ДИАЛОГ: ${history}

РЕЛЕВАНТНЫЕ СТАТЬИ:
${lawsContext}

Дай 1-2 предложения — НЕ полный ответ.

ФОРМАТ:
💡 Подсказка: [коротко, до 300 символов]

На русском.`;
}

// ============ SESSIONS ============
const sessions = new Map();

// ============ BOT ============
const bot = new Bot(BOT_TOKEN);
bot.catch((err) => console.error('Bot error:', err));

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
  const summaryPrompt = isDE
    ? 'Fasse die Trainingssitzung zusammen: Stärken, Schwächen, was zu wiederholen. Kurz.'
    : 'Подведи итог: сильные стороны, слабые, что повторить. Кратко.';

  // Найти статьи по всему инциденту + истории
  const allText = sess.incident + ' ' + sess.history.map(m => m.content).join(' ');
  const relevant = findRelevantArticles(sess.jur, allText, 5);

  const messages = [
    { role: 'system', content: isDE
      ? `Du bist Trainer-Anwalt. Status: ${STATUS[sess.status].de}.`
      : `Ты тренер-адвокат. Статус: ${STATUS[sess.status].ru}.`
    },
    ...sess.history,
    { role: 'user', content: summaryPrompt + '\n\nRelevante Artikel:\n' + buildLawsContext(sess.jur, relevant) }
  ];

  try {
    await ctx.replyWithChatAction('typing');
    const r = await ai.chat.completions.create({
      model: MODEL, messages, temperature: 0.5, max_tokens: 1200
    });
    const answer = r.choices[0].message.content;
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
  const lastQuestion = sess.history.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
  const query = sess.incident + ' ' + lastQuestion;
  const relevant = findRelevantArticles(sess.jur, query, 3);
  const histText = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🤖 ') + m.content).join('\n\n');

  try {
    await ctx.replyWithChatAction('typing');
    const r = await ai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: buildHintPrompt(sess.jur, sess.status, isDE ? 'de' : 'ru', sess.incident, histText, relevant) }],
      temperature: 0.5, max_tokens: 300
    });
    const answer = r.choices[0].message.content;
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

  // ========== ПЕРВЫЙ ИНЦИДЕНТ ==========
  if (!sess.incident) {
    sess.incident = text;
    sess.history = [{ role: 'user', content: (isDE ? 'Vorfall: ' : 'Инцидент: ') + text }];

    await ctx.reply(isDE ? '⏳ Erste Frage wird vorbereitet...' : '⏳ Готовлю первый вопрос...');

    // Найти релевантные статьи по инциденту
    const relevant = findRelevantArticles(sess.jur, text, 5);
    console.log(`🔍 RAG: найдено ${relevant.length} статей для "${text.slice(0, 50)}..."`);

    try {
      await ctx.replyWithChatAction('typing');
      const histText = sess.history.map(m => m.content).join('\n\n');
      const r = await ai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: buildQuestionPrompt(sess.jur, sess.status, isDE ? 'de' : 'ru', sess.incident, histText, relevant) }],
        temperature: 0.7, max_tokens: 500
      });
      const question = r.choices[0].message.content;
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

  // RAG по последнему вопросу + ответу
  const lastQuestion = sess.history.filter(m => m.role === 'assistant').slice(-1)[0]?.content || '';
  const query = lastQuestion + ' ' + text;
  const relevant = findRelevantArticles(sess.jur, query, 5);
  console.log(`🔍 RAG: найдено ${relevant.length} статей для оценки`);

  try {
    await ctx.replyWithChatAction('typing');
    const histText = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n');

    // 1) Разбор
    const evalRes = await ai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: buildEvaluationPrompt(sess.jur, sess.status, isDE ? 'de' : 'ru', sess.incident, histText, relevant) }],
      temperature: 0.4, max_tokens: 700
    });
    const evaluation = evalRes.choices[0].message.content;
    await ctx.reply(evaluation, { parse_mode: 'Markdown' });

    // 2) Следующий вопрос — с новыми RAG-статьями
    const allText = sess.incident + ' ' + sess.history.map(m => m.content).join(' ');
    const nextRelevant = findRelevantArticles(sess.jur, allText, 5);

    await ctx.replyWithChatAction('typing');
    const histText2 = histText + '\n\n📊 Оценка была дана.';
    const nextRes = await ai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: buildQuestionPrompt(sess.jur, sess.status, isDE ? 'de' : 'ru', sess.incident, histText2, nextRelevant) }],
      temperature: 0.7, max_tokens: 500
    });
    const nextQuestion = nextRes.choices[0].message.content;
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
  await ctx.reply('Отправьте /finish для итоговой оценки.');
});

// ============ START ============
bot.start({ drop_pending_updates: true });
console.log('🚀 Dopros Trainer v3 (мини-RAG) started');

const httpApp = express();
httpApp.get('/', (req, res) => res.send('Dopros Trainer v3 (mini-RAG)'));
const PORT = process.env.PORT || 3000;
httpApp.listen(PORT, () => console.log('HTTP server on port ' + PORT));
