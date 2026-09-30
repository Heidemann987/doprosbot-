// bot.js — Dopros Trainer v2 (DE/CH/AT + KZ/RU, разбор после ответа, два режима)
const { Bot, InlineKeyboard } = require('grammy');
const OpenAI = require('openai');
const express = require('express');

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

// ============ STATUS ============
const STATUS = {
  witness:    { ru: 'Свидетель',    de: 'Zeuge' },
  suspect:    { ru: 'Подозреваемый', de: 'Beschuldigter' },
  accused:    { ru: 'Обвиняемый',   de: 'Angeklagter' },
  victim:     { ru: 'Потерпевший',  de: 'Geschädigter' },
  plaintiff:  { ru: 'Истец',        de: 'Kläger' },
  defendant:  { ru: 'Ответчик',     de: 'Beklagter' }
};

// ============ JURISDICTIONS ============
const JUR = {
  KZ: { name: 'Казахстан',  lang: 'ru' },
  RU: { name: 'Россия',     lang: 'ru' },
  DE: { name: 'Deutschland', lang: 'de' }
};

// ============ РАЗРЕШЁННЫЕ СТАТЬИ (жёсткий список) ============
const ALLOWED_LAWS = {
  KZ: [
    'Конституция РК, ст. 77 п. 6', 'Конституция РК, ст. 77 п. 7',
    'Конституция РК, ст. 77 п. 8', 'Конституция РК, ст. 77 п. 9',
    'УПК РК, ст. 28', 'УПК РК, ст. 64', 'УПК РК, ст. 65',
    'УПК РК, ст. 69', 'УПК РК, ст. 210', 'УПК РК, ст. 215',
    'УПК РК, ст. 216', 'УПК РК, ст. 535',
    'ГПК РК, ст. 46', 'ГПК РК, ст. 202', 'КоАП РК, ст. 744'
  ],
  RU: [
    'Конституция РФ, ст. 49', 'Конституция РФ, ст. 50', 'Конституция РФ, ст. 51',
    'УПК РФ, ст. 46', 'УПК РФ, ст. 47', 'УПК РФ, ст. 56',
    'УПК РФ, ст. 189', 'УПК РФ, ст. 190', 'УПК РФ, ст. 191',
    'УПК РФ, ст. 425', 'ГПК РФ, ст. 35', 'ГПК РФ, ст. 69',
    'ГПК РФ, ст. 177', 'КоАП РФ, ст. 25.1'
  ],
  DE: [
    'Grundgesetz, Art. 1', 'Grundgesetz, Art. 2', 'Grundgesetz, Art. 20 Abs. 3',
    'StPO § 136', 'StPO § 136a', 'StPO § 163a', 'StPO § 52',
    'StPO § 55', 'StPO § 58', 'StPO § 70',
    'JGG §§ 67, 70', 'ZPO §§ 138, 141', 'OWiG §§ 55, 67, 71'
  ]
};

// ============ PROMPT — только ВОПРОС следователя ============
function buildQuestionPrompt(jur, status, lang, mode, incident, history) {
  const lawsList = ALLOWED_LAWS[jur].map(l => '- ' + l).join('\n');
  const statusText = lang === 'de' ? STATUS[status].de : STATUS[status].ru;

  if (lang === 'de') {
    return `Du bist Ermittler in einem Verhör in ${JUR[jur].name}. Verfahrensstatus: ${statusText}. Modus: ${mode === 'exam' ? 'Prüfung' : 'Anfänger'}.

VORFALL:
${incident}

BISHERIGER DIALOG:
${history}

DEINE AUFGABE: Stelle die NÄCHSTE Frage als Ermittler. NUR die Frage — keine Analyse, kein Kommentar, keine Bewertung.

FORMAT:
🎭 Ermittler: [Frage auf Deutsch]

VERBOTENE ARTIKEL (nutze NUR diese):
${lawsList}

REGELN:
- Nur EINE Frage.
- Auf Deutsch.
- Ohne Analyse, ohne Bewertung, ohne Trainer-Kommentar.
- Realistisch, passend zum Status "${statusText}".`;
  }

  return `Ты — следователь на допросе в ${JUR[jur].name}. Процессуальный статус: ${statusText}. Режим: ${mode === 'exam' ? 'экзамен' : 'новичок'}.

ИНЦИДЕНТ:
${incident}

ПРЕДЫДУЩИЙ ДИАЛОГ:
${history}

ТВОЯ ЗАДАЧА: задать СЛЕДУЮЩИЙ вопрос как следователь. ТОЛЬКО вопрос — без анализа, без комментариев, без оценки.

ФОРМАТ:
🎭 Следователь: [вопрос на русском]

ЗАПРЕЩЁННЫЕ СТАТЬИ (используй ТОЛЬКО эти):
${lawsList}

ПРАВИЛА:
- Только ОДИН вопрос.
- На русском.
- Без анализа, без оценки, без комментариев тренера.
- Реалистично, под статус "${statusText}".`;
}

// ============ PROMPT — только РАЗБОР ответа ============
function buildEvaluationPrompt(jur, status, lang, mode, incident, history) {
  const lawsList = ALLOWED_LAWS[jur].map(l => '- ' + l).join('\n');
  const statusText = lang === 'de' ? STATUS[status].de : STATUS[status].ru;

  if (lang === 'de') {
    return `Du bist Trainer-Anwalt. Bewerte die letzte Antwort des Nutzers im Verhör.

Status: ${statusText}. Modus: ${mode === 'exam' ? 'Prüfung' : 'Anfänger'}.

VORFALL:
${incident}

DIALOG BISHER:
${history}

DEINE AUFGABE: Bewerte die LETZTE Antwort des Nutzers und gib den ETALON.

FORMAT (streng einhalten):

📊 Bewertung: [✅ / ⚠️ / ❌]

⚠️ Fehler: [was falsch war — oder "keine"]

🎯 Etalon: [korrekte Formulierung, die der Nutzer hätte sagen sollen]

📚 Artikel: [genaue Artikel aus der Liste unten]

💬 Kurz: [1-2 Sätze warum]

VERBOTENE ARTIKEL (nutze NUR diese):
${lawsList}

REGELN:
- Bewerte nur die LETZTE Antwort des Nutzers.
- Etalon = ideale Formulierung.
- Nur Artikel aus der Liste.
- Auf Deutsch.
- Wenn Nutzer nichts geantwortet hat — schreibe "⚠️ Keine Antwort."`;
  }

  return `Ты — тренер-адвокат. Оцени последний ответ пользователя на допросе.

Статус: ${statusText}. Режим: ${mode === 'exam' ? 'экзамен' : 'новичок'}.

ИНЦИДЕНТ:
${incident}

ДИАЛОГ:
${history}

ТВОЯ ЗАДАЧА: оцени ПОСЛЕДНИЙ ответ пользователя и дай ЭТАЛОН.

ФОРМАТ (строго):

📊 Оценка: [✅ / ⚠️ / ❌]

⚠️ Ошибка: [что не так — или "нет"]

🎯 Эталон: [правильная формулировка, которую стоило сказать]

📚 Статьи: [точные статьи из списка ниже]

💬 Коротко: [1-2 предложения почему]

ЗАПРЕЩЁННЫЕ СТАТЬИ (используй ТОЛЬКО эти):
${lawsList}

ПРАВИЛА:
- Оценивай только ПОСЛЕДНИЙ ответ пользователя.
- Эталон — идеальная формулировка.
- Только статьи из списка.
- На русском.
- Если пользователь не ответил — напиши "⚠️ Ответа не было."`;
}

// ============ PROMPT — подсказка ============
function buildHintPrompt(jur, status, lang, incident, history) {
  const lawsList = ALLOWED_LAWS[jur].map(l => '- ' + l).join('\n');
  const statusText = lang === 'de' ? STATUS[status].de : STATUS[status].ru;

  if (lang === 'de') {
    return `Du bist Trainer-Anwalt. Der Nutzer bittet um eine HINWEIS für die aktuelle Frage.

Status: ${statusText}.
VORFALL: ${incident}
DIALOG: ${history}

Gib 1-2 Sätze, die dem Nutzer helfen, aber NICHT die komplette Antwort verraten.

FORMAT:
💡 Hinweis: [kurz, unter 300 Zeichen]

Erlaubte Artikel: ${lawsList}

Auf Deutsch.`;
  }

  return `Ты — тренер-адвокат. Пользователь просит ПОДСКАЗКУ к текущему вопросу.

Статус: ${statusText}.
ИНЦИДЕНТ: ${incident}
ДИАЛОГ: ${history}

Дай 1-2 предложения, которые помогут, но НЕ раскроют полный ответ.

ФОРМАТ:
💡 Подсказка: [коротко, до 300 символов]

Разрешённые статьи: ${lawsList}

На русском.`;
}

// ============ SESSIONS ============
// { userId, jur, mode, status, incident, history: [], currentQuestion }
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

// ============ ВЫБОР ЮРИСДИКЦИИ → РЕЖИМ ============
bot.callbackQuery(/^jur:(KZ|RU|DE)$/, async (ctx) => {
  const jur = ctx.match[1];
  sessions.set(ctx.from.id, {
    jur, mode: null, status: null, incident: null, history: [], currentQuestion: null
  });

  await ctx.answerCallbackQuery();

  const isDE = jur === 'DE';
  const kb = new InlineKeyboard()
    .text(isDE ? '🎓 Anfänger' : '🎓 Новичок', 'mode:beginner').row()
    .text(isDE ? '📝 Prüfung' : '📝 Экзамен', 'mode:exam');

  await ctx.reply(
    isDE
      ? '🎓 *Anfänger* — mit Hinweisen.\n📝 *Prüfung* — ohne Hinweise, strenger.\n\nWählen Sie den Modus:'
      : '🎓 *Новичок* — с подсказками.\n📝 *Экзамен* — без подсказок, строже.\n\nВыберите режим:',
    { parse_mode: 'Markdown', reply_markup: kb }
  );
});

// ============ ВЫБОР РЕЖИМА → СТАТУС ============
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

// ============ СТАТУС → ИНЦИДЕНТ ============
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
    '⚙️ Как работает:\n' +
    '1. Выбираете юрисдикцию и режим\n' +
    '2. Описываете инцидент\n' +
    '3. Отвечаете на вопросы следователя\n' +
    '4. После каждого ответа — разбор с эталоном',
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
    ? 'Fasse die Trainingssitzung zusammen. Bewerte: Stärken, Schwächen, was zu wiederholen. Kurz.'
    : 'Подведи итог тренировки: сильные стороны, слабые, что повторить. Кратко.';

  const messages = [
    { role: 'system', content: isDE
      ? `Du bist Trainer-Anwalt. Status: ${STATUS[sess.status].de}.`
      : `Ты тренер-адвокат. Статус: ${STATUS[sess.status].ru}.`
    },
    ...sess.history,
    { role: 'user', content: summaryPrompt }
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

// ============ КНОПКА ПОДСКАЗКА ============
bot.callbackQuery('hint', async (ctx) => {
  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.answerCallbackQuery({ text: 'Начните с /start' });
  if (sess.mode === 'exam') {
    return ctx.answerCallbackQuery({ text: 'В режиме экзамена подсказки отключены', show_alert: true });
  }

  await ctx.answerCallbackQuery();

  const isDE = sess.jur === 'DE';
  const histText = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🤖 ') + m.content).join('\n\n');

  try {
    await ctx.replyWithChatAction('typing');
    const r = await ai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: buildHintPrompt(sess.jur, sess.status, isDE ? 'de' : 'ru', sess.incident, histText) }],
      temperature: 0.5,
      max_tokens: 300
    });
    const answer = r.choices[0].message.content;
    await ctx.reply(answer, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка подсказки.');
  }
});

// ============ ОСНОВНОЙ ОБРАБОТЧИК ============
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

  // ========== ПЕРВОЕ СООБЩЕНИЕ — ИНЦИДЕНТ ==========
  if (!sess.incident) {
    sess.incident = text;
    sess.history = [{ role: 'user', content: (isDE ? 'Vorfall: ' : 'Инцидент: ') + text }];

    await ctx.reply(isDE ? '⏳ Erste Frage wird vorbereitet...' : '⏳ Готовлю первый вопрос...');

    try {
      await ctx.replyWithChatAction('typing');
      const histText = sess.history.map(m => m.content).join('\n\n');
      const r = await ai.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: buildQuestionPrompt(sess.jur, sess.status, isDE ? 'de' : 'ru', sess.mode, sess.incident, histText) }],
        temperature: 0.7, max_tokens: 500
      });
      const question = r.choices[0].message.content;
      sess.currentQuestion = question;
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

  // ========== ПОЛЬЗОВАТЕЛЬ ОТВЕЧАЕТ ==========
  sess.history.push({ role: 'user', content: text });

  await ctx.reply(isDE ? '⏳ Analyse läuft...' : '⏳ Анализирую ответ...');

  try {
    await ctx.replyWithChatAction('typing');
    const histText = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n');

    // 1) Разбор ответа
    const evalRes = await ai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: buildEvaluationPrompt(sess.jur, sess.status, isDE ? 'de' : 'ru', sess.mode, sess.incident, histText) }],
      temperature: 0.4, max_tokens: 700
    });
    const evaluation = evalRes.choices[0].message.content;

    await ctx.reply(evaluation, { parse_mode: 'Markdown' });

    // 2) Следующий вопрос
    await ctx.replyWithChatAction('typing');
    const histText2 = sess.history.map(m => (m.role === 'user' ? '👤 ' : '🎭 ') + m.content).join('\n\n') + '\n\n📊 Оценка была дана.';
    const nextRes = await ai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: buildQuestionPrompt(sess.jur, sess.status, isDE ? 'de' : 'ru', sess.mode, sess.incident, histText2) }],
      temperature: 0.7, max_tokens: 500
    });
    const nextQuestion = nextRes.choices[0].message.content;
    sess.currentQuestion = nextQuestion;
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

// ============ КНОПКА "ЗАВЕРШИТЬ" ============
bot.callbackQuery('finish_action', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('Отправьте /finish для итоговой оценки.');
});

// ============ START ============
bot.start({ drop_pending_updates: true });
console.log('🚀 Dopros Trainer v2 started');

const httpApp = express();
httpApp.get('/', (req, res) => res.send('Dopros Trainer v2 is running'));
const PORT = process.env.PORT || 3000;
httpApp.listen(PORT, () => console.log('HTTP server on port ' + PORT));
