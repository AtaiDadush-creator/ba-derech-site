// הטופס של ba-derech.com. סקריפט נפרד: בלי טוקנים, בלי וואטסאפ, בלי קשר לגשר.
// מוסיף שורה לגיליון ושולח מייל לבעל העסק. עונה "ok" רק אחרי שהשורה נשמרה.
var OWNER = 'AtaiDadush@ba-derech.com';
var TAB = 'פניות';
var HEAD = ['זמן', 'פונה', 'שם', 'טלפון', 'כיתה', 'לחזור ב', 'הערה', 'עמוד', 'סטטוס'];
var MAX_PER_HOUR = 20;   // יותר מזה בשעה: "error:busy", והאתר מציע וואטסאפ
var MIN_MS = 2000;       // נשלח מהר מזה: כנראה בוט, נשמר עם סטטוס "חשד"
var KEEP_DAYS = 395;     // כל פנייה מהטופס נמחקת מהגיליון ומהמייל אחרי 13 חודשים, בלי קשר לסטטוס

// להריץ פעם אחת מהעורך: כותרות, חיבור לגיליון, טריגר מחיקה שבועי, ומייל בדיקה.
// להריץ שוב אחרי כל עדכון קוד שמוסיף הרשאה (למשל Gmail, בשביל מחיקת המיילים הישנים).
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB) || ss.getSheets()[0].setName(TAB);
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'purge') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('purge').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).create();
  GmailApp.search('subject:"פנייה מהאתר"', 0, 1); // מבקש את הרשאת Gmail כבר עכשיו, בשביל המחיקה השבועית
  MailApp.sendEmail(OWNER, 'בדיקה: טופס האתר מחובר', 'אם המייל הזה הגיע, הטופס יודע לשלוח לך מייל. השלב הבא: פריסה (Deploy).');
}

function doGet() { return text_('ok'); }

function doPost(e) {
  var d;
  try { d = JSON.parse(e && e.postData ? e.postData.contents : ''); } catch (x) { return text_('error:bad'); }
  if (!d || typeof d !== 'object') return text_('error:bad');
  // מלכודת מלאה או שליחה מהירה מדי: כנראה בוט. לא זורקים: נשמר עם סטטוס "חשד", בלי מייל ובלי לספור במכסה.
  // הבוט מקבל "ok" ולא לומד כלום, ופנייה אמיתית שנתפסה בטעות לא הולכת לאיבוד.
  var spam = d.hp || !(Number(d.t) >= MIN_MS);
  var l = clean_(d);
  if (!l) return text_(spam ? 'ok' : 'error:invalid');

  var lock = LockService.getScriptLock();
  if (spam) {
    if (!lock.tryLock(10000)) return text_('ok');
    try { append_(l, 'חשד'); } finally { lock.releaseLock(); }
    return text_('ok');
  }

  // אותה פנייה פעמיים: אותו מזהה טופס, או אותו טלפון עם אותו פונה, כיתה והערה בתוך 10 דקות.
  // טופס של אח או אחות, או פנייה מתוקנת, הם פנייה חדשה.
  var cache = CacheService.getScriptCache();
  var idKey = d.id ? 'id' + String(d.id).replace(/[^\w-]/g, '').slice(0, 40) : '';
  var dupKey = 'ph' + l.phone + l.role + l.grade + hash_(l.note);
  var seen = function () { return Boolean((idKey && cache.get(idKey)) || cache.get(dupKey)); };
  if (seen()) return text_('ok'); // מסלול מהיר, בלי לחכות לנעילה

  if (!lock.tryLock(10000)) return text_('error:busy');
  try {
    if (seen()) return text_('ok'); // שוב אחרי הנעילה: ניסיון חוזר שחיכה לנעילה לא יוצר שורה שנייה
    var hour = 'h' + Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyyMMddHH');
    var n = Number(cache.get(hour) || 0) + 1;
    cache.put(hour, String(n), 3700);
    if (n > MAX_PER_HOUR) return text_('error:busy');
    append_(l, 'חדש');
    if (idKey) cache.put(idKey, '1', 21600);
    cache.put(dupKey, '1', 600);
  } finally {
    lock.releaseLock();
  }
  mail_(l);
  return text_('ok');
}

function clean_(d) {
  // טקסט נקי: בלי תווי בקרה, בלי U+2014, בלי נוסחה בתחילת תא, וטקסט שנראה כמו מספר או תאריך נשאר טקסט ("3-4" לא הופך לתאריך).
  function s(v, n) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u2014]/g, ' ').replace(/\s+/g, ' ').trim()
      .slice(0, n).replace(/^(?:[=+\-@]|[\d\s.,:\/-]+$)/, "'$&");
  }
  var p = String(d.phone || '').replace(/\D/g, '').replace(/^00/, '');
  if (p.indexOf('972') === 0) p = p.slice(3);
  if (p.charAt(0) !== '0') p = '0' + p;
  var role = d.role === 'parent' ? 'הורה' : d.role === 'teacher' ? 'מורה' : '';
  var name = s(d.name, 60);
  if (!role || name.length < 2 || !/^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(p)) return null;
  var grade = '';
  if (role === 'הורה') {
    grade = { 'ו': 'ו׳', 'ז': 'ז׳', 'ח': 'ח׳', 'ט': 'ט׳', 'אחרת': 'אחרת' }[d.grade] || '';
    if (!grade) return null;
  }
  return {
    role: role, name: name, phone: '972' + p.slice(1), grade: grade,
    contact: d.contact === 'call' ? 'שיחה' : 'וואטסאפ', note: s(d.note, 500), page: s(d.page, 40)
  };
}

function mail_(l) {
  var b = ['פונה: ' + l.role, 'שם: ' + l.name, 'טלפון: ' + l.phone, 'לחזור ב: ' + l.contact];
  if (l.grade) b.push('כיתה: ' + l.grade);
  if (l.note) b.push('הערה: יש בגיליון'); // טקסט ההערה נשאר רק בגיליון, שנמחק בזמן
  b.push('', 'וואטסאפ: https://wa.me/' + l.phone);
  try {
    MailApp.sendEmail(OWNER, 'פנייה מהאתר: ' + l.role + (l.grade ? ', כיתה ' + l.grade : ''), b.join('\n'),
      { name: 'האתר של בדרך הנכונה' });
  } catch (x) {
    console.error(x); // השורה כבר נשמרה בגיליון
  }
}

// טריגר שבועי (נוצר ב-setup): מוחק מהגיליון כל פנייה בת יותר מ-13 חודשים, בלי קשר לסטטוס,
// ומעביר לאשפה את המיילים "פנייה מהאתר" באותו גיל (עד 100 בכל ריצה; השאר בשבוע הבא).
function purge() {
  var sh = sheet_(), v = sh.getDataRange().getValues(), cut = Date.now() - KEEP_DAYS * 864e5;
  for (var r = v.length - 1; r >= 1; r--) {
    var t = v[r][0] instanceof Date ? v[r][0].getTime() : 0;
    if (t && t < cut) sh.deleteRow(r + 1);
  }
  var old = GmailApp.search('subject:"פנייה מהאתר" older_than:' + KEEP_DAYS + 'd', 0, 100);
  if (old.length) GmailApp.moveThreadsToTrash(old);
}

function append_(l, status) {
  sheet_().appendRow([new Date(), l.role, l.name, "'" + l.phone, l.grade, l.contact, l.note, l.page, status]);
}

// גיבוב קצר של ההערה, בשביל מפתח הכפילויות במטמון.
function hash_(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function sheet_() {
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getSheetByName(TAB);
}

function text_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}
