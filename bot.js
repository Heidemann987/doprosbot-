// bot.js — Dopros Trainer (multilingual, status, evaluation, TXT export, fixed Markdown)
const { Bot, InlineKeyboard, InputFile } = require('grammy');
const OpenAI = require('openai');
const express = require('express');
const fs = require('fs');

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

// ============ STATUS LABELS ============
const STATUS = {
  witness:   { ru: 'Свидетель', de: 'Zeuge' },
  suspect:   { ru: 'Подозреваемый', de: 'Beschuldigter' },
  accused:   { ru: 'Обвиняемый', de: 'Angeklagter' },
  victim:    { ru: 'Потерпевший', de: 'Geschädigter' },
  plaintiff: { ru: 'Истец', de: 'Kläger' },
  defendant: { ru: 'Ответчик', de: 'Beklagter' }
};

// ============ SYSTEM PROMPTS ============
function buildPrompt(jur, status) {
  const statusRu = STATUS[status]?.ru || 'Свидетель';
  const statusDe = STATUS[status]?.de || 'Zeuge';

  const base = {
    KZ: {
      code: 'Республика Казахстан',
      laws: `- Конституция РК, ст. 77 п. 7 — право не свидетельствовать против себя, супруга и близких родственников
- Конституция РК, ст. 77 п. 6 — обвиняемый не обязан доказывать свою невиновность
- Конституция РК, ст. 77 п. 8 — сомнения толкуются в пользу обвиняемого
- Конституция РК, ст. 77 п. 9 — незаконные доказательства не имеют силы
- УПК РК, ст. 28 — освобождение от обязанности давать показания
- УПК РК, ст. 64 — права подозреваемого
- УПК РК, ст. 65 — права свидетеля, имеющего право на защиту
- УПК РК, ст. 69 — права обвиняемого
- УПК РК, ст. 210, 215, 216, 535 — правила допроса
- ГПК РК, ст. 46, 202
- КоАП РК, ст. 744`
    },
    RU: {
      code: 'Российская Федерация',
      laws: `- Конституция РФ, ст. 51 — право не свидетельствовать против себя и близких
- Конституция РФ, ст. 49 — презумпция невиновности
- Конституция РФ, ст. 50 — недопустимость незаконных доказательств
- УПК РФ, ст. 46 — права подозреваемого
- УПК РФ, ст. 47 — права обвиняемого
- УПК РФ, ст. 56 — права свидетеля
- УПК РФ, ст. 189, 190 — правила допроса
- УПК РФ, ст. 191, 425 — допрос несовершеннолетнего
- ГПК РФ, ст. 35, 69, 177
- КоАП РФ, ст. 25.1`
    },
    DE: {
      code: 'Bundesrepublik Deutschland',
      laws: `- Grundgesetz, Art. 1 — Menschenwürde
- Grundgesetz, Art. 2 — allgemeine Handlungsfreiheit
- Grundgesetz, Art. 20 Abs. 3 — Rechtsstaatsprinzip
- StPO § 136 — Belehrung des Beschuldigten
- StPO § 136a — Verbot von Folter, Täuschung, Ermüdung, Zwang
- StPO § 163a — Vernehmung des Beschuldigten
- StPO § 55 — Auskunftsverweigerungsrecht
- StPO § 52 — Zeugnisverweigerungsrecht (Angehörige)
- StPO § 58 — Vernehmung von Zeugen
- StPO § 70 — Folgen der Zeugnisverweigerung
- JGG §§ 67, 70 — Jugendstrafrecht
- ZPO §§ 138, 141, 373, 395
- OWiG §§ 55, 67, 71`
    }
  };

  const b = base[jur];

  if (jur === 'DE') {
    return `Du bist ein Verhör-Trainer für die ${b.code}. Verfahrensstatus des Nutzers: ${statusDe}. Sprache: Deutsch.

WICHTIG ZUR FORMATIERUNG:
- Verwende AUSSCHLIESSLICH einfache Sternchen für Fett: *Text* — nicht **Text**.
- Für Aufzählungen nutze "•" und Emojis.
- Keine Markdown-Tabellen.

ROLLE: Realistische Verhörsimulation. Antworte STRIKT in diesem Format:

🎭 Ermittler:
(Realistische Frage oder Aussage des Ermittlers, passend zum Status "${statusDe}". Nur auf Deutsch.)

💡 Trainer-Anwalt:
• 🎯 Analyse der Falle: Ziel der Frage und Risiko
• ⚠️ Gefährlicher Fehler: Wie man NICHT antworten sollte
• 🛡️ Richtige Strategie: 2-3 sichere Formulierungen mit Normverweisen

📊 Bewertung Ihrer letzten Antwort:
(Wenn der Nutzer bereits geantwortet hat — bewerte kurz: ✅/⚠️/❌. Beim ersten Mal — schreibe "Erste Runde — Bewertung folgt.")

RECHTSGRUNDLAGE:
${b.laws}

REGELN:
1. Nur auf die gestellte Frage antworten lehren.
2. Unterscheide "Ich erinnere mich nicht" und Schweigerecht.
3. Der Verfahrensstatus ist "${statusDe}" — berücksichtige ihn.
4. Keine Rechtsberatung zur Sache.
5. Antworte NUR auf Deutsch.`;
  }

  return `Ты — тренажёр допроса для ${b.code}. Процессуальный статус пользователя: ${statusRu}. Язык: русский.

ВАЖНО ПО ФОРМАТИРОВАНИЮ:
- Используй ТОЛЬКО одинарные звёздочки для жирного: *Текст* — не **Текст**.
- Для списков используй "•" и эмодзи.
- Никаких markdown-таблиц.

РОЛЬ: Реалистичная симуляция допроса. Отвечай СТРОГО в формате:

🎭 Следователь:
(Реалистичный вопрос или реплика, соответствующие статусу "${statusRu}". Только на русском.)

💡 Тренер-адвокат:
• 🎯 Разбор ловушки: цель вопроса и риск
• ⚠️ Опасная ошибка: как отвечать НЕЛЬЗЯ
• 🛡️ Правильная стратегия: 2-3 безопасные формулировки со ссылками на нормы

📊 Оценка вашего прошлого ответа:
(Если пользователь уже отвечал — оцени кратко: ✅/⚠️/❌. В первый раз — напиши "Первый раунд — оценка будет дальше.")

ПРАВОВАЯ БАЗА:
${b.laws}

ПРАВИЛА:
1. Учи отвечать только на заданный вопрос.
2. Различай "не помню" и отказ от показаний.
3. Статус "${statusRu}" — учитывай его.
4. Не давай консультаций по существу дела.
5. Отвечай ТОЛЬКО на русском.`;
}

// ============ SESSIONS ============
const sessions = new Map();

// ============ BOT ============
const bot = new Bot(BOT_TOKEN);

bot.catch((err) => console.error('Bot error:', err));

// /start
bot.command('start', async (ctx) => {
  sessions.delete(ctx.from.id);

  const kb = new InlineKeyboard()
    .text('🇰🇿 Казахстан', 'jur:KZ').row()
    .text('🇷🇺 Россия', 'jur:RU').row()
    .text('🇩🇪 Deutschland', 'jur:DE');

  await ctx.reply(
    '⚖️ *Тренажёр допроса / Verhör-Trainer*\n\n' +
    'Выберите юрисдикцию / Wählen Sie die Jurisdiktion:',
    { parse_mode: 'Markdown', reply_markup: kb }
  );
});

// Выбор юрисдикции
bot.callbackQuery(/^jur:(KZ|RU|DE)$/, async (ctx) => {
  const jur = ctx.match[1];
  sessions.set(ctx.from.id, { jurisdiction: jur, status: null, incident: null, history: [] });

  await ctx.answerCallbackQuery();

  if (jur === 'DE') {
    const kb = new InlineKeyboard()
      .text('👤 Zeuge', 'st:witness').row()
      .text('🚨 Beschuldigter', 'st:suspect').row()
      .text('⚖️ Angeklagter', 'st:accused').row()
      .text('🛡️ Geschädigter', 'st:victim').row()
      .text('📋 Kläger', 'st:plaintiff').row()
      .text('📋 Beklagter', 'st:defendant');

    await ctx.reply('🇩🇪 Deutschland\n\n*Wählen Sie Ihren Verfahrensstatus:*', {
      parse_mode: 'Markdown',
      reply_markup: kb
    });
    return;
  }

  const kb = new InlineKeyboard()
    .text('👤 Свидетель', 'st:witness').row()
    .text('🚨 Подозреваемый', 'st:suspect').row()
    .text('⚖️ Обвиняемый', 'st:accused').row()
    .text('🛡️ Потерпевший', 'st:victim').row()
    .text('📋 Истец', 'st:plaintiff').row()
    .text('📋 Ответчик', 'st:defendant');

  const title = jur === 'KZ' ? '🇰🇿 Казахстан' : '🇷🇺 Россия';

  await ctx.reply(`${title}\n\n*Выберите свой процессуальный статус:*`, {
    parse_mode: 'Markdown',
    reply_markup: kb
  });
});

// Выбор статуса
bot.callbackQuery(/^st:(witness|suspect|accused|victim|plaintiff|defendant)$/, async (ctx) => {
  const status = ctx.match[1];
  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.answerCallbackQuery({ text: 'Начните с /start' });

  sess.status = status;
  await ctx.answerCallbackQuery();

  const jur = sess.jurisdiction;

  if (jur === 'DE') {
    await ctx.reply(
      `🇩🇪 Deutschland · *${STATUS[status].de}*\n\n` +
      `*Beschreiben Sie Ihren Vorfall ausführlich.*\n\n` +
      `Bitte keine Namen, Adressen, Telefonnummern.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const title = jur === 'KZ' ? '🇰🇿 Казахстан' : '🇷🇺 Россия';

  await ctx.reply(
    `${title} · *${STATUS[status].ru}*\n\n` +
    `*Опишите подробно свой инцидент.*\n\n` +
    `Не указывайте ФИО, адрес, ИИН, телефоны.`,
    { parse_mode: 'Markdown' }
  );
});

// /reset
bot.command('reset', async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply('Сессия сброшена. / Sitzung zurückgesetzt.\n\nНапишите /start.');
});

// /help
bot.command('help', async (ctx) => {
  await ctx.reply(
    '⚖️ *Dopros Trainer — Hilfe / Помощь*\n\n' +
    '• /start — начать / beginnen\n' +
    '• /reset — сбросить / zurücksetzen\n' +
    '• /finish — завершить тренировку / Training beenden\n' +
    '• /export — сохранить отчёт / Bericht speichern\n' +
    '• /help — справка / Hilfe',
    { parse_mode: 'Markdown' }
  );
});

// /finish
bot.command('finish', async (ctx) => {
  const sess = sessions.get(ctx.from.id);
  if (!sess || !sess.incident) {
    return ctx.reply('Сначала начните тренировку: /start');
  }

  const finishPrompt = sess.jurisdiction === 'DE'
    ? 'Beende die Trainingssitzung. Gib eine abschließende Bewertung: Stärken, Schwächen, Empfehlungen. Kurz und konkret.'
    : 'Заверши тренировку. Дай итоговую оценку: сильные стороны, слабые стороны, рекомендации. Кратко и по делу.';

  sess.history.push({ role: 'user', content: finishPrompt });

  try {
    await ctx.replyWithChatAction('typing');
    const response = await ai.chat.completions.create({
      model: MODEL,
      messages: sess.history,
      temperature: 0.7,
      max_tokens: 1500
    });
    const answer = response.choices[0].message.content;
    await sendLong(ctx, '🎓 *ИТОГ / ERGEBNIS*\n\n' + answer, 'Markdown');
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка при получении итога.');
  }
});

// /export
bot.command('export', async (ctx) => {
  const userId = ctx.from.id;
  const sess = sessions.get(userId);

  if (!sess || !sess.incident) {
    return ctx.reply('Нет активной сессии. Начните с /start');
  }

  await ctx.reply('📄 Готовлю файл... / Datei wird vorbereitet...');

  try {
    let content = '';

    content += '===========================================\n';
    content += '       DOPROS TRAINER — TRAINING REPORT\n';
    content += '===========================================\n\n';
    content += 'Datum / Дата: ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '\n';
    content += 'Jurisdiktion / Юрисдикция: ' + sess.jurisdiction + '\n';
    content += 'Status / Статус: ' + (STATUS[sess.status]?.ru || '—') + ' / ' + (STATUS[sess.status]?.de || '—') + '\n\n';

    content += '-------------------------------------------\n';
    content += 'INCIDENT / ИНЦИДЕНТ:\n';
    content += '-------------------------------------------\n';
    content += (sess.incident || '—') + '\n\n';

    content += '-------------------------------------------\n';
    content += 'DIALOG / ДИАЛОГ:\n';
    content += '-------------------------------------------\n\n';

    sess.history.forEach((msg) => {
      if (msg.role === 'system') return;
      const label = msg.role === 'user' ? '► USER / ПОЛЬЗОВАТЕЛЬ' : '◆ TRAINER / ТРЕНЕР';
      content += label + ':\n' + (msg.content || '') + '\n\n';
    });

    content += '===========================================\n';
    content += 'Dies ist Übungsmaterial, keine Rechtsberatung.\n';
    content += 'Это тренировочный материал, не юридическая консультация.\n';
    content += '===========================================\n';

    const tmpPath = '/tmp/Dopros_Training_' + userId + '_' + Date.now() + '.txt';
    fs.writeFileSync(tmpPath, content, 'utf8');

    await ctx.replyWithDocument(new InputFile(tmpPath), {
      caption: '📄 Ваша тренировка сохранена. / Ihre Trainingseinheit wurde gespeichert.'
    });

    fs.unlink(tmpPath, () => {});
  } catch (e) {
    console.error('Export error:', e);
    await ctx.reply('Ошибка при создании файла. / Fehler beim Erstellen der Datei.');
  }
});

// Основной обработчик
bot.on('message:text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  const sess = sessions.get(ctx.from.id);
  if (!sess) return ctx.reply('Начните с /start');
  if (!sess.jurisdiction) return ctx.reply('Выберите юрисдикцию: /start');
  if (!sess.status) return ctx.reply('Выберите процессуальный статус.');
  if (!sess.incident) {
    sess.incident = text;
    sess.history = [
      { role: 'system', content: buildPrompt(sess.jurisdiction, sess.status) },
      {
        role: 'user',
        content: sess.jurisdiction === 'DE'
          ? `Vorfall: ${text}\n\nBeginne das Training. Erste Frage als Ermittler + Kommentar des Trainer-Anwalts.`
          : `Инцидент: ${text}\n\nНачни тренировку. Первый вопрос следователя + разбор тренера-адвоката.`
      }
    ];
  } else {
    sess.history.push({ role: 'user', content: text });
    const sys = sess.history[0];
    const rest = sess.history.slice(1);
    if (rest.length > 24) sess.history = [sys, ...rest.slice(-24)];
  }

  const loading = sess.jurisdiction === 'DE' ? '⏳ Antwort wird vorbereitet...' : '⏳ Готовлю ответ...';
  await ctx.reply(loading);

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
    await sendLong(ctx, answer, 'Markdown');
  } catch (e) {
    console.error('AI error:', e);
    await ctx.reply('Ошибка ИИ. Попробуйте позже. / KI-Fehler.');
  }
});

// ============ ОТПРАВКА ДЛИННЫХ СООБЩЕНИЙ ============
// Конвертирует **text** в *text* (правильный синтаксис Telegram Legacy Markdown)
function cleanForTelegram(text) {
  // Заменяем **bold** на *bold* (Telegram Legacy Markdown)
  let cleaned = text.replace(/\*\*([^*]+?)\*\*/g, '*$1*');
  // Заменяем __underline__ на _italic_ (Telegram поддерживает _italic_, не __underline__)
  cleaned = cleaned.replace(/__([^_]+?)__/g, '_$1_');
  return cleaned;
}

async function sendLong(ctx, text, parseMode) {
  const MAX = 4000;
  const cleaned = parseMode === 'Markdown' ? cleanForTelegram(text) : text;
  const opts = parseMode ? { parse_mode: parseMode } : {};

  // Разбиваем на части по MAX символов
  const parts = [];
  let remaining = cleaned;

  while (remaining.length > MAX) {
    let end = remaining.lastIndexOf('\n\n', MAX);
    if (end < MAX / 2) end = remaining.lastIndexOf('\n', MAX);
    if (end < MAX / 2) end = MAX;
    parts.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trim();
  }
  if (remaining) parts.push(remaining);

  for (const part of parts) {
    try {
      await ctx.reply(part, opts);
    } catch (e) {
      // Fallback: если Markdown сломан — отправляем без parse_mode
      console.warn('Markdown parse error, sending plain:', e.message);
      await ctx.reply(part);
    }
  }
}

// ============ START ============
bot.start();
console.log('🚀 Dopros Trainer started');

const httpApp = express();
httpApp.get('/', (req, res) => res.send('Dopros Trainer is running'));
const PORT = process.env.PORT || 3000;
httpApp.listen(PORT, () => console.log('HTTP server on port ' + PORT));
