# הטופס באתר: הסקריפט ב-Google (Apps Script)

סקריפט נפרד מהגשר. לא מכניסים אליו טוקנים ולא מחברים אותו לוואטסאפ.

הסקריפט רק מוסיף שורה לגיליון "פניות מהאתר" ושולח מייל לתיבת העסק. עד שהוא נפרס (וב-src/owner.json הערך של leadsEndpoint הוא null), הטופס באתר פותח וואטסאפ עם הפרטים. אותו קוד שמור גם בריפו: tools/leads-apps-script/Code.gs.

## הקוד (Code.gs)

```js
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
```

למה ככה: fetch עם גוף מחרוזת נשלח כ-text/plain ולא דורש preflight; Apps Script מחזיר הפניה אחת ל-googleusercontent.com עם `access-control-allow-origin: *`, ולכן האתר יכול לקרוא את התשובה. הטלפון נשמר עם גרש כדי שהגיליון לא יוריד ספרות, וגם הערה שנראית כמו מספר או תאריך נשמרת כטקסט.

מה הסקריפט עושה עם פנייה חשודה: אם שדה המלכודת מלא או שהטופס נשלח פחות מ-2 שניות אחרי שנפתח, השורה נשמרת עם סטטוס "חשד", בלי מייל. האתר מקבל "ok" כרגיל. כדאי להציץ פעם בכמה זמן בשורות "חשד": פנייה אמיתית שנתפסה בטעות לא הולכת לאיבוד.

מחיקה: פעם בשבוע הסקריפט מוחק מהגיליון כל פנייה בת יותר מ-13 חודשים, בלי קשר לסטטוס, ומעביר לאשפה את המיילים "פנייה מהאתר" באותו גיל. במייל עצמו אין את טקסט ההערה, רק "הערה: יש בגיליון".

## שלבי הפריסה (לעתיי, 15 דקות)

1. נכנסים ל-drive.google.com עם החשבון של העסק. חדש (New) > Google Sheets > גיליון ריק. קוראים לו "פניות מהאתר". לא משתפים אותו עם אף אחד.
2. בגיליון, בתפריט למעלה: תוספים (Extensions) > Apps Script. נפתח עורך קוד בלשונית חדשה.
3. מוחקים את כל מה שכתוב בעורך, מדביקים את הקוד מ-docs/LEADS-SETUP.md, ולוחצים על סמל השמירה (הדיסקט).
4. למעלה, ליד "הפעלה" (Run), בוחרים בתפריט את setup ולוחצים "הפעלה". Google תבקש אישור: בוחרים את החשבון, לוחצים "מתקדם" (Advanced), ואז "מעבר אל ..." ו"אישור" (Allow). האישור כולל גישה ל-Gmail: היא משמשת רק למחיקת המיילים "פנייה מהאתר" הישנים. האזהרה מופיעה כי זה סקריפט שכתבת בעצמך. אחרי דקה אמור להגיע אליך מייל "בדיקה: טופס האתר מחובר".
5. למעלה מימין: פריסה (Deploy) > פריסה חדשה (New deployment). ליד "בחירת סוג" לוחצים על גלגל השיניים ובוחרים "אפליקציית אינטרנט" (Web app).
   - "הפעלה בתור" (Execute as): אני (Me).
   - "למי יש גישה" (Who has access): כל אחד (Anyone).
   - לוחצים "פריסה" (Deploy). אם האפשרות "כל אחד" חסרה, צריך לאפשר אותה בניהול Google Workspace (Admin > Apps > Google Workspace > Drive and Docs), ואז לחזור לשלב הזה.
6. מעתיקים את כתובת האפליקציה (Web app URL). היא מתחילה ב-https://script.google.com/ ונגמרת ב-/exec (בחשבון Workspace היא יכולה להיראות כמו https://script.google.com/a/macros/ba-derech.com/s/.../exec, וגם זה תקין). הכתובת אינה סוד: שולחים אותה ל-Claude, או מדביקים ב-src/owner.json בשורה `"leadsEndpoint": "https://script.google.com/macros/s/.../exec"`.
7. בדיקה, אחרי שהאתר התעדכן: ממלאים את הטופס בעמוד "צרו קשר" עם הטלפון שלך. צריך לראות "קיבלנו, תודה", שורה חדשה בגיליון ומייל "פנייה מהאתר". אם המייל לא מצלצל בטלפון, ב-Gmail יוצרים מסנן לנושא "פנייה מהאתר" ומסמנים "תמיד לסמן כחשוב".
8. עמודת סטטוס: "חדש" לפנייה רגילה, "חשד" לפנייה שנראית כמו בוט. כל פנייה נמחקת לבד מהגיליון ומהמייל אחרי 13 חודשים, גם של מי שהצטרף, ולכן את פרטי התלמידים שומרים במקום אחר, לא בגיליון הזה.
9. שינוי בקוד בהמשך: מדביקים את הקוד החדש ושומרים, מריצים שוב setup פעם אחת (אם התווספה הרשאה, למשל Gmail, Google תבקש לאשר אותה), ואז פריסה > ניהול פריסות (Manage deployments) > העיפרון > גרסה: גרסה חדשה > פריסה. לא "פריסה חדשה", כי היא מחליפה את הכתובת.
10. אם מגיעות פניות זבל: פריסה > ניהול פריסות > ארכוב (Archive). הטופס באתר יציע אז לשלוח את הפרטים בוואטסאפ, עד שתהיה פריסה חדשה.

## אחרי הפריסה, בריפו

- src/owner.json: `"leadsEndpoint": "<הכתובת משלב 6>"` (במקום null).
- `npm test` עובר, דוחפים. הכפתור בטופס הופך מ"להמשיך בוואטסאפ" ל"לשלוח".
- docs/OWNER-TODO.md: מוחקים את השורה של הטופס.
- בהמשך (לא בגרסה הזו): מערכת המכירות יכולה לקרוא את הגיליון "פניות מהאתר" ולהציג פנייה חדשה במשחק. טוצ'אט רק באישור של עתיי.
