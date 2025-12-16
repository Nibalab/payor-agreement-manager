import React, { useState } from 'react';
import * as XLSX from 'xlsx';

export default function PayorAgreementManager() {
  const [oldFile, setOldFile] = useState(null);
  const [newFile, setNewFile] = useState(null);
  const [oldData, setOldData] = useState(null);
  const [newData, setNewData] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);

  const readExcelFile = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          
          const sheets = {};
          workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
              header: 1,
              defval: '',
              raw: false,
              dateNF: 'yyyy-mm-dd'
            });
            sheets[sheetName] = jsonData;
          });
          
          resolve({ workbook, sheets, sheetNames: workbook.SheetNames });
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  const handleOldFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setLoading(true);
    try {
      setOldFile(file);
      const data = await readExcelFile(file);
      setOldData(data);
      setComparison(null);
    } catch (error) {
      alert('Error reading old file: ' + error.message);
    }
    setLoading(false);
  };

  const handleNewFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setLoading(true);
    try {
      setNewFile(file);
      const data = await readExcelFile(file);
      setNewData(data);
      setComparison(null);
    } catch (error) {
      alert('Error reading new file: ' + error.message);
    }
    setLoading(false);
  };

  const findColumnIndex = (headers, columnName) => {
    return headers.findIndex(h => 
      h && h.toString().toUpperCase().trim().includes(columnName.toUpperCase().trim())
    );
  };

  const compareFiles = () => {
    if (!oldData || !newData) {
      alert('Please upload both old and new files first');
      return;
    }

    setLoading(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const changes = {
        date: today,
        changedRecords: [],
        summary: {},
        sheetsCompared: []
      };

      const commonSheets = oldData.sheetNames.filter(sheet => 
        newData.sheetNames.includes(sheet)
      );

      commonSheets.forEach(sheetName => {
        const oldSheet = oldData.sheets[sheetName];
        const newSheet = newData.sheets[sheetName];

        if (!oldSheet || !newSheet || oldSheet.length < 2 || newSheet.length < 2) {
          return;
        }

        const headers = oldSheet[0];
        const surchargeColIndex = findColumnIndex(headers, 'SURCHARGEMULTIPLIER');

        if (surchargeColIndex === -1) {
          return;
        }

        changes.sheetsCompared.push(sheetName);
        changes.summary[sheetName] = { 
          total: 0, 
          found: 0, 
          notFound: 0, 
          changed: 0, 
          unchanged: 0 
        };

        let key1ColIndex = -1;
        let key2ColIndex = -1;
        let key1Name = '';
        let key2Name = '';

        if (sheetName.toLowerCase().includes('groupsurcharge')) {
          key1ColIndex = findColumnIndex(headers, 'PAYORAGREECODE');
          key2ColIndex = findColumnIndex(headers, 'BILLINGGROUPCODE');
          key1Name = 'PAYORAGREECODE';
          key2Name = 'BILLINGGROUPCODE';
        } else if (sheetName.toLowerCase().includes('itemlevelsurcharge') || sheetName.toLowerCase().includes('itemsurcharge')) {
          key1ColIndex = findColumnIndex(headers, 'PAYORAGREECODE');
          key2ColIndex = findColumnIndex(headers, 'ORDERITEMCODE');
          key1Name = 'PAYORAGREECODE';
          key2Name = 'ORDERITEMCODE';
        }

        if (key1ColIndex === -1 || key2ColIndex === -1) {
          console.warn(`Required key columns not found in ${sheetName}`);
          return;
        }

        const oldRecordsMap = new Map();
        for (let i = 1; i < oldSheet.length; i++) {
          const key1 = oldSheet[i][key1ColIndex];
          const key2 = oldSheet[i][key2ColIndex];
          
          if (key1 && key2) {
            const compositeKey = `${key1.toString().trim()}|${key2.toString().trim()}`;
            oldRecordsMap.set(compositeKey, { 
              rowIndex: i, 
              row: oldSheet[i],
              surchargeValue: oldSheet[i][surchargeColIndex],
              key1: key1,
              key2: key2
            });
          }
        }

        changes.summary[sheetName].total = newSheet.length - 1;

        for (let i = 1; i < newSheet.length; i++) {
          const newRow = newSheet[i];
          const key1 = newRow[key1ColIndex];
          const key2 = newRow[key2ColIndex];
          
          if (!key1 || !key2) continue;

          const compositeKey = `${key1.toString().trim()}|${key2.toString().trim()}`;
          const oldRecord = oldRecordsMap.get(compositeKey);
          
          if (oldRecord) {
            changes.summary[sheetName].found++;
            
            const oldSurcharge = oldRecord.surchargeValue ? oldRecord.surchargeValue.toString().trim() : '';
            const newSurcharge = newRow[surchargeColIndex] ? newRow[surchargeColIndex].toString().trim() : '';

            if (oldSurcharge !== newSurcharge) {
              changes.summary[sheetName].changed++;
              changes.changedRecords.push({
                sheet: sheetName,
                key1Name: key1Name,
                key2Name: key2Name,
                key1: key1,
                key2: key2,
                headers: headers,
                oldRow: oldRecord.row,
                newRow: newRow,
                oldSurcharge: oldSurcharge,
                newSurcharge: newSurcharge
              });
            } else {
              changes.summary[sheetName].unchanged++;
            }
          } else {
            changes.summary[sheetName].notFound++;
          }
        }
      });

      setComparison(changes);
    } catch (error) {
      alert('Error comparing files: ' + error.message);
      console.error(error);
    }
    setLoading(false);
  };

  const generateUpdatedFile = () => {
    if (!comparison || !oldData) {
      alert('Please compare files first');
      return;
    }

    if (comparison.changedRecords.length === 0) {
      alert('No price changes detected. Nothing to export.');
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const workbook = XLSX.utils.book_new();

      const changesBySheet = {};
      comparison.changedRecords.forEach(change => {
        if (!changesBySheet[change.sheet]) {
          changesBySheet[change.sheet] = [];
        }
        changesBySheet[change.sheet].push(change);
      });

      oldData.sheetNames.forEach(sheetName => {
        const oldSheet = oldData.sheets[sheetName];
        
        if (!oldSheet || oldSheet.length === 0) return;

        const isTrackedSheet = comparison.sheetsCompared.includes(sheetName);
        
        if (isTrackedSheet && changesBySheet[sheetName]) {
          const headers = [...oldSheet[0]];
          const activeToIndex = findColumnIndex(headers, 'ACTIVETO');
          const activeFromIndex = findColumnIndex(headers, 'ACTIVEFROM');

          let activeToCol = activeToIndex;
          let activeFromCol = activeFromIndex;
          
          if (activeToIndex === -1) {
            headers.push('ACTIVETO');
            activeToCol = headers.length - 1;
          }
          if (activeFromIndex === -1) {
            headers.push('ACTIVEFROM');
            activeFromCol = headers.length - 1;
          }

          const updatedData = [headers];

          // Add old records with ACTIVETO set to today
          changesBySheet[sheetName].forEach(change => {
            const oldRow = [...change.oldRow];
            while (oldRow.length < headers.length) {
              oldRow.push('');
            }
            oldRow[activeToCol] = today;
            oldRow[activeFromCol] = '';
            updatedData.push(oldRow);
          });

          // Add new records with ACTIVEFROM set to today
          changesBySheet[sheetName].forEach(change => {
            const newRow = [...change.newRow];
            while (newRow.length < headers.length) {
              newRow.push('');
            }
            newRow[activeToCol] = '';
            newRow[activeFromCol] = today;
            updatedData.push(newRow);
          });

          const worksheet = XLSX.utils.aoa_to_sheet(updatedData);
          XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        } else {
          // For unchanged sheets, copy as is
          const worksheet = XLSX.utils.aoa_to_sheet(oldSheet);
          XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
        }
      });

      const fileName = `PayorAgreement_Changes_${today}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    } catch (error) {
      alert('Error generating file: ' + error.message);
      console.error(error);
    }
  };

  // Render the UI components
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(to bottom right, #eff6ff, #e0e7ff)', padding: '24px' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto' }}>
        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', padding: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
            <div>
              <h1 style={{ fontSize: '30px', fontWeight: 'bold', color: '#1f2937' }}>Payor Agreement Price Update Manager</h1>
              <p style={{ color: '#6b7280', marginTop: '4px' }}>Automatically track Prices changes in all sheets</p>
            </div>
          </div>

          <div style={{ background: '#eff6ff', borderLeft: '4px solid #3b82f6', padding: '16px', marginBottom: '24px' }}>
            <div style={{ fontSize: '14px', color: '#1e3a8a' }}>
              <p style={{ fontWeight: '600', marginBottom: '4px' }}>How it works:</p>
              <ul style={{ listStyleType: 'disc', paddingLeft: '24px' }}>
                <li><strong>Old file:</strong> Upload complete file with all codes</li>
                <li><strong>New file:</strong> Upload only codes with price changes</li>
                <li><strong>Auto-compare:</strong> System finds all sheets with SURCHARGEMULTIPLIER and compares them</li>
                <li><strong>Export:</strong> Get only changed records with ACTIVETO/ACTIVEFROM dates</li>
              </ul>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px', marginBottom: '32px' }}>
            <div style={{ border: '2px dashed #d1d5db', borderRadius: '12px', padding: '24px' }}>
              <label style={{ cursor: 'pointer', display: 'block' }}>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleOldFileUpload}
                  style={{ display: 'none' }}
                />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>📤</div>
                  <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>Old File (Complete)</h3>
                  <p style={{ fontSize: '14px', color: '#6b7280' }}>All codes with current prices</p>
                  {oldFile && (
                    <div style={{ marginTop: '16px', color: '#16a34a', fontWeight: '500' }}>
                      ✓ {oldFile.name}
                    </div>
                  )}
                </div>
              </label>
            </div>

            <div style={{ border: '2px dashed #d1d5db', borderRadius: '12px', padding: '24px' }}>
              <label style={{ cursor: 'pointer', display: 'block' }}>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleNewFileUpload}
                  style={{ display: 'none' }}
                />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>📤</div>
                  <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>New File (Changes Only)</h3>
                  <p style={{ fontSize: '14px', color: '#6b7280' }}>Only codes with updated prices</p>
                  {newFile && (
                    <div style={{ marginTop: '16px', color: '#16a34a', fontWeight: '500' }}>
                      ✓ {newFile.name}
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', marginBottom: '32px' }}>
            <button
              onClick={compareFiles}
              disabled={!oldData || !newData || loading}
              style={{
                flex: 1,
                background: (!oldData || !newData || loading) ? '#d1d5db' : '#4f46e5',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                fontWeight: '600',
                border: 'none',
                cursor: (!oldData || !newData || loading) ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Comparing...' : 'Compare All Sheets'}
            </button>

            <button
              onClick={generateUpdatedFile}
              disabled={!comparison || comparison.changedRecords.length === 0 || loading}
              style={{
                flex: 1,
                background: (!comparison || comparison.changedRecords.length === 0 || loading) ? '#d1d5db' : '#16a34a',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                fontWeight: '600',
                border: 'none',
                cursor: (!comparison || comparison.changedRecords.length === 0 || loading) ? 'not-allowed' : 'pointer'
              }}
            >
              Export Changes Only
            </button>
          </div>

          {comparison && (
            <div>
              {comparison.sheetsCompared.length > 0 && (
                <div style={{ background: '#eef2ff', padding: '16px', borderRadius: '8px', border: '1px solid #c7d2fe', marginBottom: '24px' }}>
                  <h4 style={{ fontWeight: '600', color: '#3730a3', marginBottom: '8px' }}>Sheets Compared:</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {comparison.sheetsCompared.map(sheet => (
                      <span key={sheet} style={{ padding: '4px 12px', background: '#ddd6fe', color: '#5b21b6', borderRadius: '16px', fontSize: '14px', fontWeight: '500' }}>
                        {sheet}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ background: 'linear-gradient(to right, #eef2ff, #dbeafe)', padding: '24px', borderRadius: '12px', border: '1px solid #c7d2fe', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '20px', fontWeight: 'bold', color: '#3730a3', marginBottom: '16px' }}>Comparison Summary</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                  {Object.entries(comparison.summary).map(([sheet, stats]) => (
                    <div key={sheet} style={{ background: 'white', borderRadius: '8px', padding: '16px' }}>
                      <h4 style={{ fontWeight: '600', color: '#1f2937', marginBottom: '12px' }}>{sheet}</h4>
                      <div style={{ fontSize: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ color: '#6b7280' }}>In new file:</span>
                          <span style={{ fontWeight: 'bold', color: '#1f2937' }}>{stats.total}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ color: '#6b7280' }}>Found in old:</span>
                          <span style={{ fontWeight: 'bold', color: '#16a34a' }}>{stats.found}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ color: '#6b7280' }}>Changed:</span>
                          <span style={{ fontWeight: 'bold', color: '#4f46e5' }}>{stats.changed}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                          <span style={{ color: '#6b7280' }}>Unchanged:</span>
                          <span style={{ fontWeight: 'bold', color: '#9ca3af' }}>{stats.unchanged}</span>
                        </div>
                        {stats.notFound > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#6b7280' }}>Not found:</span>
                            <span style={{ fontWeight: 'bold', color: '#dc2626' }}>{stats.notFound}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ background: 'white', borderRadius: '8px', padding: '16px', textAlign: 'center' }}>
                  <p style={{ fontSize: '14px', color: '#6b7280' }}>Total Records to Export</p>
                  <p style={{ fontSize: '30px', fontWeight: 'bold', color: '#16a34a' }}>{comparison.changedRecords.length * 2}</p>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>({comparison.changedRecords.length} old + {comparison.changedRecords.length} new)</p>
                </div>
              </div>

              {comparison.changedRecords.length > 0 ? (
                <div style={{ background: '#f0fdf4', padding: '24px', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                  <h4 style={{ fontWeight: '600', color: '#15803d', marginBottom: '16px' }}>
                    ✓ Price Changes Detected ({comparison.changedRecords.length})
                  </h4>
                  <div style={{ maxHeight: '384px', overflowY: 'auto' }}>
                    {comparison.changedRecords.map((record, idx) => (
                      <div key={idx} style={{ background: 'white', borderRadius: '8px', padding: '16px', marginBottom: '12px', borderLeft: '4px solid #16a34a' }}>
                        <div style={{ fontWeight: '600', color: '#1f2937', marginBottom: '8px' }}>
                          {record.sheet}
                        </div>
                        <div style={{ fontSize: '14px', color: '#374151', marginBottom: '8px' }}>
                          <span style={{ fontWeight: '500' }}>{record.key1Name}:</span> <span style={{ color: '#4f46e5' }}>{record.key1}</span>
                          {' | '}
                          <span style={{ fontWeight: '500' }}>{record.key2Name}:</span> <span style={{ color: '#4f46e5' }}>{record.key2}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '14px' }}>
                          <span style={{ padding: '4px 12px', background: '#fee2e2', color: '#991b1b', borderRadius: '16px', fontFamily: 'monospace' }}>
                            Old: {record.oldSurcharge}
                          </span>
                          <span style={{ color: '#9ca3af' }}>→</span>
                          <span style={{ padding: '4px 12px', background: '#dcfce7', color: '#166534', borderRadius: '16px', fontFamily: 'monospace' }}>
                            New: {record.newSurcharge}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ background: '#fef3c7', border: '1px solid #fde047', borderRadius: '8px', padding: '24px', textAlign: 'center' }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>⚠️</div>
                  <p style={{ color: '#92400e', fontWeight: '500', fontSize: '18px' }}>No Price Changes Detected</p>
                  <p style={{ color: '#b45309', fontSize: '14px', marginTop: '8px' }}>
                    All SURCHARGEMULTIPLIER values match between old and new files
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}