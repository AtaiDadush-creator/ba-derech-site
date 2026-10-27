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
var MIN_MS = 2000;       // נשלח מהר מזה: כנראה בוט
var KEEP_DAYS = 365;     // פנייה שלא הצטרפה נמחקת אחרי שנה

// להריץ פעם אחת מהעורך: כותרות, חיבור לגיליון, טריגר מחיקה חודשי, ומייל בדיקה.
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB) || ss.getSheets()[0].setName(TAB);
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'purge') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('purge').timeBased().onMonthDay(1).atHour(4).create();
  MailApp.sendEmail(OWNER, 'בדיקה: טופס האתר מחובר', 'אם המייל הזה הגיע, הטופס יודע לשלוח לך מייל. השלב הבא: פריסה (Deploy).');
}

function doGet() { return text_('ok'); }

function doPost(e) {
  var d;
  try { d = JSON.parse(e && e.postData ? e.postData.contents : ''); } catch (x) { return text_('error:bad'); }
  if (!d || typeof d !== 'object') return text_('error:bad');
  if (d.hp || !(Number(d.t) >= MIN_MS)) return text_('ok'); // בוט: "ok" שקט, לא נשמר כלום
  var l = clean_(d);
  if (!l) return text_('error:invalid');

  var cache = CacheService.getScriptCache();
  var idKey = d.id ? 'id' + String(d.id).replace(/[^\w-]/g, '').slice(0, 40) : '';
  if ((idKey && cache.get(idKey)) || cache.get('ph' + l.phone)) return text_('ok'); // אותה פנייה פעמיים

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return text_('error:busy');
  try {
    var hour = 'h' + Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyyMMddHH');
    var n = Number(cache.get(hour) || 0) + 1;
    cache.put(hour, String(n), 3700);
    if (n > MAX_PER_HOUR) return text_('error:busy');
    sheet_().appendRow([new Date(), l.role, l.name, "'" + l.phone, l.grade, l.contact, l.note, l.page, 'חדש']);
    if (idKey) cache.put(idKey, '1', 21600);
    cache.put('ph' + l.phone, '1', 600);
  } finally {
    lock.releaseLock();
  }
  mail_(l);
  return text_('ok');
}

function clean_(d) {
  // טקסט נקי: בלי תווי בקרה, בלי U+2014, ובלי נוסחה בתחילת תא.
  function s(v, n) {
    return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f\u2014]/g, ' ').replace(/\s+/g, ' ').trim()
      .slice(0, n).replace(/^[=+\-@]/, "'$&");
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
  if (l.note) b.push('הערה: ' + l.note);
  b.push('', 'וואטסאפ: https://wa.me/' + l.phone);
  try {
    MailApp.sendEmail(OWNER, 'פנייה מהאתר: ' + l.role + (l.grade ? ', כיתה ' + l.grade : ''), b.join('\n'),
      { name: 'האתר של בדרך הנכונה' });
  } catch (x) {
    console.error(x); // השורה כבר נשמרה בגיליון
  }
}

// טריגר חודשי (נוצר ב-setup): מוחק פנייה בת יותר משנה, חוץ ממי שסומן "הצטרף" בעמודת סטטוס.
function purge() {
  var sh = sheet_(), v = sh.getDataRange().getValues(), cut = Date.now() - KEEP_DAYS * 864e5;
  for (var r = v.length - 1; r >= 1; r--) {
    var t = v[r][0] instanceof Date ? v[r][0].getTime() : 0;
    if (t && t < cut && v[r][8] !== 'הצטרף') sh.deleteRow(r + 1);
  }
}

function sheet_() {
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getSheetByName(TAB);
}

function text_(s) {
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT);
}
```

למה ככה: fetch עם גוף מחרוזת נשלח כ-text/plain ולא דורש preflight; Apps Script מחזיר הפניה אחת ל-googleusercontent.com עם `access-control-allow-origin: *`, ולכן האתר יכול לקרוא את התשובה. הטלפון נשמר עם גרש כדי שהגיליון לא יוריד ספרות.

## שלבי הפריסה (לעתיי, 15 דקות)

1. נכנסים ל-drive.google.com עם החשבון של העסק. חדש (New) > Google Sheets > גיליון ריק. קוראים לו "פניות מהאתר". לא משתפים אותו עם אף אחד.
2. בגיליון, בתפריט למעלה: תוספים (Extensions) > Apps Script. נפתח עורך קוד בלשונית חדשה.
3. מוחקים את כל מה שכתוב בעורך, מדביקים את הקוד מ-docs/LEADS-SETUP.md, ולוחצים על סמל השמירה (הדיסקט).
4. למעלה, ליד "הפעלה" (Run), בוחרים בתפריט את setup ולוחצים "הפעלה". Google תבקש אישור: בוחרים את החשבון, לוחצים "מתקדם" (Advanced), ואז "מעבר אל ..." ו"אישור" (Allow). האזהרה מופיעה כי זה סקריפט שכתבת בעצמך. אחרי דקה אמור להגיע אליך מייל "בדיקה: טופס האתר מחובר".
5. למעלה מימין: פריסה (Deploy) > פריסה חדשה (New deployment). ליד "בחירת סוג" לוחצים על גלגל השיניים ובוחרים "אפליקציית אינטרנט" (Web app).
   - "הפעלה בתור" (Execute as): אני (Me).
   - "למי יש גישה" (Who has access): כל אחד (Anyone).
   - לוחצים "פריסה" (Deploy). אם האפשרות "כל אחד" חסרה, צריך לאפשר אותה בניהול Google Workspace (Admin > Apps > Google Workspace > Drive and Docs), ואז לחזור לשלב הזה.
6. מעתיקים את כתובת האפליקציה (Web app URL). היא מתחילה ב-https://script.google.com/macros/s/ ונגמרת ב-/exec. הכתובת אינה סוד: שולחים אותה ל-Claude, או מדביקים ב-src/owner.json בשורה `"leadsEndpoint": "https://script.google.com/macros/s/.../exec"`.
7. בדיקה, אחרי שהאתר התעדכן: ממלאים את הטופס בעמוד "צרו קשר" עם הטלפון שלך. צריך לראות "קיבלנו, תודה", שורה חדשה בגיליון ומייל "פנייה מהאתר". אם המייל לא מצלצל בטלפון, ב-Gmail יוצרים מסנן לנושא "פנייה מהאתר" ומסמנים "תמיד לסמן כחשוב".
8. מי שהצטרף: כותבים "הצטרף" בעמודת סטטוס. כל השאר נמחקים לבד אחרי 12 חודשים.
9. שינוי בקוד בהמשך: פריסה > ניהול פריסות (Manage deployments) > העיפרון > גרסה: גרסה חדשה > פריסה. לא "פריסה חדשה", כי היא מחליפה את הכתובת.
10. אם מגיעות פניות זבל: פריסה > ניהול פריסות > ארכוב (Archive). הטופס באתר יציע אז לשלוח את הפרטים בוואטסאפ, עד שתהיה פריסה חדשה.

## אחרי הפריסה, בריפו

- src/owner.json: `"leadsEndpoint": "<הכתובת משלב 6>"` (במקום null).
- `npm test` עובר, דוחפים. הכפתור בטופס הופך מ"להמשיך בוואטסאפ" ל"לשלוח".
- docs/OWNER-TODO.md: מוחקים את השורה של הטופס.
- בהמשך (לא בגרסה הזו): מערכת המכירות יכולה לקרוא את הגיליון "פניות מהאתר" ולהציג פנייה חדשה במשחק. טוצ'אט רק באישור של עתיי.
