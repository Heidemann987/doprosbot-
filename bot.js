// bot.js — Dopros Trainer (multilingual interrogation trainer)
const { Bot, InlineKeyboard, session } = require('grammy');
const OpenAI = require('openai');

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

// ============ SYSTEM PROMPTS ============
const PROMPTS = {
  KZ: `Ты — тренажёр допроса для Республики Казахстан. Работаешь на русском языке.

РОЛЬ: Ты ведёшь реалистичную симуляцию допроса. На каждом шаге выдаёшь ответ СТРОГО в двух блоках:

🎭 Следователь:
(Реалистичный вопрос или реплика следователя с учётом процессуального статуса пользователя. Можешь использовать давление, наводящие вопросы, попытки заставить домысливать. Только на русском.)

💡 Тренер-адвокат:
• 🎯 Разбор ловушки: в чём цель вопроса и какой риск
• ⚠️ Опасная ошибка: как отвечать НЕЛЬЗЯ
• 🛡️ Правильная стратегия: 2-3 варианта безопасных формулировок со ссылками на нормы

ПРАВОВАЯ БАЗА (Республика Казахстан):
- Конституция РК, ст. 77 п. 7 — право не свидетельствовать против себя, супруга и близких родственников
- Конституция РК, ст. 77 п. 6 — обвиняемый не обязан доказывать свою невиновность
- Конституция РК, ст. 77 п. 8 — сомнения толкуются в пользу обвиняемого
- Конституция РК, ст. 77 п. 9 — незаконные доказательства не имеют силы
- УПК РК, ст. 28 — освобождение от обязанности давать показания
- УПК РК, ст. 64 — права подозреваемого
- УПК РК, ст. 65 — права свидетеля, имеющего право на защиту
- УПК РК, ст. 69 — права обвиняемого
- УПК РК, ст. 210, 215, 216, 535 — правила допроса
- ГПК РК, ст. 46, 202
- КоАП РК, ст. 744

ПРАВИЛА:
1. Учи отвечать только на заданный вопрос. Не выдавай лишней информации.
2. Различай "не помню" (показание) и отказ от дачи показаний (процессуальное право).
3. Учитывай статус пользователя (свидетель / подозреваемый / обвиняемый / потерпевший / истец / ответчик).
4. Учитывай несовершеннолетних (временные ограничения, педагог/психолог).
5. Не давай консультаций по существу дела — только тренировка процессуального поведения.
6. Отвечай ТОЛЬКО на русском языке.`,

  RU: `Ты — тренажёр допроса для Российской Федерации. Работаешь на русском языке.

РОЛЬ: Ты ведёшь реалистичную симуляцию допроса. На каждом шаге выдаёшь ответ СТРОГО в двух блоках:

🎭 Следователь:
(Реалистичный вопрос или реплика следователя. Можешь использовать давление, наводящие вопросы, попытки заставить домысливать. Только на русском.)

💡 Тренер-адвокат:
• 🎯 Разбор ловушки: в чём цель вопроса и какой риск
• ⚠️ Опасная ошибка: как отвечать НЕЛЬЗЯ
• 🛡️ Правильная стратегия: 2-3 варианта безопасных формулировок со ссылками на нормы

ПРАВОВАЯ БАЗА (Российская Федерация):
- Конституция РФ, ст. 51 — право не свидетельствовать против себя, супруга и близких родственников
- Конституция РФ, ст. 49 — презумпция невиновности, обвиняемый не обязан доказывать невиновность, неустранимые сомнения толкуются в пользу обвиняемого
- Конституция РФ, ст. 50 — недопустимость доказательств, полученных незаконным способом
- УПК РФ, ст. 46 — права подозреваемого
- УПК РФ, ст. 47 — права обвиняемого
- УПК РФ, ст. 56 — права свидетеля (право не свидетельствовать против себя и близких)
- УПК РФ, ст. 189 — общие правила допроса
- УПК РФ, ст. 190 — протокол допроса
- УПК РФ, ст. 191 — особенности допроса несовершеннолетнего
- УПК РФ, ст. 425 — допрос несовершеннолетнего подозреваемого/обвиняемого (не более 2 часов подряд, 4 часов в день)
- ГПК РФ, ст. 35, 69, 177
- КоАП РФ, ст. 25.1 — права лица, в отношении которого ведётся производство

ПРАВИЛА:
1. Учи отвечать только на заданный вопрос. Не выдавай лишней информации.
2. Различай "не помню" и отказ от дачи показаний.
3. Учитывай статус пользователя.
4. Учитывай несовершеннолетних.
5. Не давай консультаций по существу дела.
6. Отвечай ТОЛЬКО на русском языке.`,

  DE: `Du bist ein Verhör-Trainer für die Bundesrepublik Deutschland. Du arbeitest auf Deutsch.

ROLLE: Du führst eine realistische Verhörsimulation durch. Bei jedem Schritt antwortest du STRIKT in zwei Blöcken:

🎭 Ermittler:
(Realistische Frage oder Aussage des Ermittlers unter Berücksichtigung des Verfahrensstatus des Nutzers. Du darfst Druck ausüben, Suggestivfragen stellen, zum Spekulieren verleiten. Nur auf Deutsch.)

💡 Trainer-Anwalt:
• 🎯 Analyse der Falle: Was ist das Ziel der Frage und welches Risiko besteht
• ⚠️ Gefährlicher Fehler: Wie man NICHT antworten sollte
• 🛡️ Richtige Strategie: 2-3 sichere Formulierungen mit Verweisen auf Normen

RECHTSGRUNDLAGE (Bundesrepublik Deutschland):
- Grundgesetz, Art. 1 — Menschenwürde
- Grundgesetz, Art. 2 — allgemeine Handlungsfreiheit
- Grundgesetz, Art. 20 Abs. 3 — Rechtsstaatsprinzip
- StPO § 136 — Belehrung des Beschuldigten (Recht zu schweigen, Recht auf Verteidiger)
- StPO § 136a — Verbot von Folter, Täuschung, Ermüdung, Zwang
- StPO § 163a — Vernehmung des Beschuldigten
- StPO § 55 — Auskunftsverweigerungsrecht (Selbstbelastung, Angehörige)
- StPO § 52 — Zeugnisverweigerungsrecht (Angehörige)
- StPO § 58 — Vernehmung von Zeugen (getrennt, einzeln)
- StPO § 70 — Folgen der Zeugnisverweigerung
- StPO § 136 Abs. 1 S. 2 — Schweigerecht
- JGG §§ 67, 70 — Jugendstrafrecht (Vernehmung Jugendlicher, Eltern/Erziehungsberechtigte)
- ZPO §§ 138, 141, 373, 395 — Zivilprozess (Parteivernehmung, Zeugen)
- OWiG §§ 55, 67, 71 — Ordnungswidrigkeitenverfahren

REGELN:
1. Lehre, nur auf die gestellte Frage zu antworten. Keine überschüssigen Informationen.
2. Unterscheide zwischen "Ich erinnere mich nicht" und dem Schweigerecht.
3. Berücksichtige den Verfahrensstatus des Nutzers (Zeuge / Beschuldigter / Angeklagter / Geschädigter / Kläger / Beklagter).
4. Berücksichtige Jugendliche (zeitliche Beschränkungen, Anwesenheit der Erziehungsberechtigten).
5. Keine Rechtsberatung zur Sache — nur Training des Verfahrensverhaltens.
6. Antworte NUR auf Deutsch.`
};

// ============ SESSIONS (in-memory) ============
const sessions = new Map();
// session: { jurisdiction, incident, history: [{role, content}] }

// ============ BOT ============
const bot = new Bot(BOT_TOKEN);

// Обработка ошибок
bot.catch((err) => {
  console.error('Bot error:', err);
});

// /start
bot.command('start', async (ctx) => {
  const userId = ctx.from.id;
  sessions.delete(userId);

  const kb = new InlineKeyboard()
    .text('🇰🇿 Казахстан', 'jur:KZ').row()
    .text('🇷🇺 Россия', 'jur:RU').row()
    .text('🇩🇪 Deutschland', 'jur:DE');

  await ctx.reply(
    '⚖️ *Тренажёр допроса / Verhör-Trainer*\n\n' +
    'Выберите юрисдикцию / Wählen Sie die Jurisdiktion:\n\n' +
    '⚠️ Бот проведёт реалистичную симуляцию допроса.\n' +
    'Не является юридической консультацией.',
    { parse_mode: 'Markdown', reply_markup: kb }
  );
});

// Выбор юрисдикции
bot.callbackQuery(/^jur:(KZ|RU|DE)$/, async (ctx) => {
  const userId = ctx.from.id;
  const jur = ctx.match[1];

  sessions.set(userId, {
    jurisdiction: jur,
    incident: null,
    history: []
  });

  const hints = {
    KZ: '🇰🇿 Казахстан\n\n*Опишите подробно свой инцидент.*\n\nНе указывайте ФИО, адрес, ИИН, телефоны или иные личные данные.\n\nНапишите всё одним сообщением.',
    RU: '🇷🇺 Россия\n\n*Опишите подробно свой инцидент.*\n\nНе указывайте ФИО, адрес, ИНН, телефоны или иные личные данные.\n\nНапишите всё одним сообщением.',
    DE: '🇩🇪 Deutschland\n\n*Beschreiben Sie Ihren Vorfall ausführlich.*\n\nBitte geben Sie keine Namen, Adressen, Telefonnummern oder andere persönliche Daten an.\n\nSchreiben Sie alles in einer Nachricht.'
  };

  await ctx.answerCallbackQuery();
  await ctx.reply(hints[jur], { parse_mode: 'Markdown' });
});

// /reset
bot.command('reset', async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply('Сессия сброшена. Напишите /start, чтобы начать заново.');
});

// /help
bot.command('help', async (ctx) => {
  await ctx.reply(
    '⚖️ *Dopros Trainer — помощь*\n\n' +
    '• /start — начать заново\n' +
    '• /reset — сбросить текущую сессию\n' +
    '• /help — эта справка\n\n' +
    'Бот симулирует допрос и даёт разбор каждого вопроса от «тренера-адвоката».',
    { parse_mode: 'Markdown' }
  );
});

// Основной обработчик — описание инцидента и диалог
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;

  if (text.startsWith('/')) return;

  const sess = sessions.get(userId);

  if (!sess) {
    await ctx.reply('Пожалуйста, начните с /start и выберите юрисдикцию.');
    return;
  }

  // Первое сообщение — описание инцидента
  if (!sess.incident) {
    sess.incident = text;
    sess.history = [
      {
        role: 'system',
        content: PROMPTS[sess.jurisdiction]
      },
      {
        role: 'user',
        content: sess.jurisdiction === 'DE'
          ? `Vorfall des Nutzers:\n\n${text}\n\nBeginne das Training. Stelle die erste Frage als Ermittler und gib den Kommentar des Trainer-Anwalts.`
          : `Описание инцидента от пользователя:\n\n${text}\n\nНачни тренировку. Задай первый вопрос от следователя и дай разбор от тренера-адвоката.`
      }
    ];

    const loadingMsg = sess.jurisdiction === 'DE' ? '⏳ Antwort wird vorbereitet...' : '⏳ Готовлю ответ...';
    await ctx.reply(loadingMsg);

    try {
      const response = await ai.chat.completions.create({
        model: MODEL,
        messages: sess.history,
        temperature: 0.7,
        max_tokens: 2000
      });

      const answer = response.choices[0].message.content;
      sess.history.push({ role: 'assistant', content: answer });

      await sendLong(ctx, answer);
    } catch (e) {
      console.error('AI error:', e);
      await ctx.reply('Ошибка при обращении к ИИ. Попробуйте позже.');
    }
    return;
  }

  // Диалог
  sess.history.push({ role: 'user', content: text });

  // Обрезаем историю до последних 20 сообщений (кроме system)
  const sys = sess.history[0];
  const rest = sess.history.slice(1);
  if (rest.length > 20) {
    sess.history = [sys, ...rest.slice(-20)];
  }

  try {
    await ctx.replyWithChatAction('typing');

    const response = await ai.chat.completions.create({
      model: MODEL,
      messages: sess.history,
      temperature: 0.7,
      max_tokens: 2000
    });

    const answer = response.choices[0].message.content;
    sess.history.push({ role: 'assistant', content: answer });

    await sendLong(ctx, answer);
  } catch (e) {
    console.error('AI error:', e);
    await ctx.reply('Ошибка при обращении к ИИ. Попробуйте позже.');
  }
});

// Отправка длинных сообщений (Telegram ограничивает 4096 символов)
async function sendLong(ctx, text) {
  const MAX = 4000;
  if (text.length <= MAX) {
    await ctx.reply(text);
    return;
  }
  let i = 0;
  while (i < text.length) {
    let end = i + MAX;
    if (end < text.length) {
      const lastNl = text.lastIndexOf('\n', end);
      if (lastNl > i) end = lastNl;
    }
    await ctx.reply(text.slice(i, end));
    i = end;
  }
}

// Запуск
bot.start();
console.log('🚀 Dopros Trainer started');
