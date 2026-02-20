/**
 * 大会検索・チーム検索 Webアプリ
 * Google Apps Script
 */

// ★★★ ここにスプレッドシートのIDを設定してください ★★★
// スプレッドシートのURLから取得: https://docs.google.com/spreadsheets/d/【ここがID】/edit
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';

// スプレッドシートを取得
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// シートを名前で取得（末尾スペースに対応）
function getSheetByNameFlexible(ss, name) {
  // まず完全一致を試す
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  
  // 末尾スペース付きを試す
  sheet = ss.getSheetByName(name + ' ');
  if (sheet) return sheet;
  
  // 全シートから部分一致で探す
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().trim() === name) {
      return sheets[i];
    }
  }
  
  return null;
}

/**
 * Webアプリのエントリーポイント
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('大会検索・チーム検索')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 都道府県リストを取得
 */
function getPrefectures() {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameFlexible(ss, '都道府県_地方マスター');
  const data = sheet.getDataRange().getValues();
  
  const prefectures = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      prefectures.push({
        prefecture: data[i][0],
        region: data[i][1]
      });
    }
  }
  return prefectures;
}

/**
 * カテゴリリストを取得（チームDBから重複を除去）
 */
function getCategories() {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameFlexible(ss, 'チームDB');
  const data = sheet.getDataRange().getValues();
  
  const categorySet = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][1]) {
      // カテゴリーは複数ある場合があるので分割
      const categories = String(data[i][1]).split(/[\s,、]+/);
      categories.forEach(cat => {
        if (cat.trim()) {
          categorySet.add(cat.trim());
        }
      });
    }
  }
  
  // ソートして返す
  return Array.from(categorySet).sort();
}

/**
 * 地方リストを取得
 */
function getRegions() {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameFlexible(ss, '呼べる地方ルール');
  const data = sheet.getDataRange().getValues();
  
  const regionSet = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      regionSet.add(data[i][0]);
    }
  }
  return Array.from(regionSet);
}

/**
 * 都道府県から地方を取得
 */
function getRegionByPrefecture(prefecture) {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameFlexible(ss, '都道府県_地方マスター');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === prefecture) {
      return data[i][1];
    }
  }
  return null;
}

/**
 * 基準地方から呼べる地方リストを取得
 */
function getCallableRegions(baseRegion) {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameFlexible(ss, '呼べる地方ルール');
  const data = sheet.getDataRange().getValues();
  
  const callableRegions = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === baseRegion && data[i][1]) {
      callableRegions.push(data[i][1]);
    }
  }
  return callableRegions;
}

/**
 * メイン検索関数
 * @param {string} startDate - 開始日 (YYYY-MM-DD形式)
 * @param {string} endDate - 終了日 (YYYY-MM-DD形式)
 * @param {string} prefecture - 都道府県
 * @param {string} category - カテゴリ (U-15など)
 */
function search(startDate, endDate, prefecture, category) {
  const result = {
    tournaments: [],
    teams: [],
    region: '',
    callableRegions: []
  };
  
  // 都道府県から地方を取得
  const region = getRegionByPrefecture(prefecture);
  result.region = region;
  
  // 呼べる地方を取得
  const callableRegions = getCallableRegions(region);
  result.callableRegions = callableRegions;
  
  // 大会検索
  result.tournaments = searchTournaments(startDate, endDate, prefecture, category, region);
  
  // チーム検索
  result.teams = searchTeams(category, callableRegions);
  
  return result;
}

/**
 * 大会検索
 */
function searchTournaments(startDate, endDate, prefecture, category, region) {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameFlexible(ss, '大会_季節カレンダー');
  const data = sheet.getDataRange().getValues();
  
  const searchStart = new Date(startDate);
  const searchEnd = new Date(endDate);
  
  console.log('検索条件:', { startDate, endDate, prefecture, category, region });
  console.log('searchStart:', searchStart, 'searchEnd:', searchEnd);
  
  const tournaments = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const tourCategory = String(row[0] || '');  // A列: カテゴリ
    const tourName = row[1];                     // B列: 大会名
    const tourPrefecture = row[2];               // C列: 範囲（都道府県）
    const tourRegion = row[3];                   // D列: 範囲名（地方）
    const tourStart = row[4];                    // E列: 開始月
    const tourEnd = row[5];                      // F列: 終了月
    
    if (!tourName || !tourStart || !tourEnd) continue;
    
    // カテゴリフィルタ
    // カテゴリが指定されている場合、マッチするかチェック
    if (category) {
      const normalizedCategory = normalizeCategory(category);
      const normalizedTourCategory = normalizeCategory(tourCategory);
      
      // 部活動(高校)の場合は高校カテゴリとして扱う
      const isMatch = normalizedTourCategory.includes(normalizedCategory) ||
                      (normalizedCategory === 'U15' && tourCategory.includes('部活動')) ||
                      (normalizedCategory === 'U18' && tourCategory.includes('高校'));
      
      if (!isMatch) continue;
    }
    
    // 地域フィルタ（同じ地方または同じ都道府県）
    const isSameRegion = tourRegion === region || 
                         tourPrefecture === prefecture ||
                         tourRegion === '' ||  // 地方が空の場合は全国大会と見なす
                         tourPrefecture === prefecture;
    
    if (!isSameRegion && tourRegion !== region) {
      // 完全に関係ない地方の大会はスキップ
      // ただし、全国大会（範囲が空）は含める
      if (tourRegion && tourRegion !== region && tourPrefecture && tourPrefecture !== prefecture) {
        continue;
      }
    }
    
    // 日付フィルタ（期間の重複チェック）
    const tourStartDate = new Date(tourStart);
    const tourEndDate = new Date(tourEnd);
    
    // 期間が重複しているかチェック
    const isOverlapping = !(searchEnd < tourStartDate || searchStart > tourEndDate);
    
    if (isOverlapping) {
      tournaments.push({
        category: tourCategory,
        name: tourName,
        prefecture: tourPrefecture,
        region: tourRegion,
        startDate: formatDate(tourStartDate),
        endDate: formatDate(tourEndDate)
      });
    }
  }
  
  return tournaments;
}

/**
 * チーム検索
 */
function searchTeams(category, callableRegions) {
  const ss = getSpreadsheet();
  const sheet = getSheetByNameFlexible(ss, 'チームDB');
  const data = sheet.getDataRange().getValues();
  
  const teams = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const teamName = row[0];           // A列: チーム名
    const teamCategory = String(row[1] || ''); // B列: カテゴリー
    const teamPrefecture = row[2];     // C列: 都道府県
    const teamRegion = row[3];         // D列: 地方
    
    if (!teamName) continue;
    
    // カテゴリフィルタ
    if (category) {
      const normalizedCategory = normalizeCategory(category);
      const teamCategories = teamCategory.split(/[\s,、]+/).map(c => normalizeCategory(c));
      
      if (!teamCategories.includes(normalizedCategory)) continue;
    }
    
    // 地方フィルタ
    if (callableRegions.length > 0 && !callableRegions.includes(teamRegion)) {
      continue;
    }
    
    teams.push({
      name: teamName,
      category: teamCategory,
      prefecture: teamPrefecture,
      region: teamRegion
    });
  }
  
  // 地方ごとにグループ化
  const groupedTeams = {};
  teams.forEach(team => {
    if (!groupedTeams[team.region]) {
      groupedTeams[team.region] = [];
    }
    groupedTeams[team.region].push(team);
  });
  
  return groupedTeams;
}

/**
 * カテゴリを正規化（U-15 -> U15 など）
 */
function normalizeCategory(category) {
  return String(category).toUpperCase().replace(/[-_\s]/g, '');
}

/**
 * 日付をフォーマット
 */
function formatDate(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

/**
 * 初期データを取得（ページ読み込み時）
 */
function getInitialData() {
  return {
    prefectures: getPrefectures(),
    categories: getCategories(),
    regions: getRegions()
  };
}

