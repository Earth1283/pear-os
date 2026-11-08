import { useState } from 'react'
import { os } from '../store'
import { APP_NAMES, dayKey, fmtDur, shameToast, trend, useScreenTime, verdict, weekSummary, buildReport } from '../lib/screenTime'

export function ScreenTimePane() {
  const data = useScreenTime((s) => s.data)
  const [sure, setSure] = useState(false)
  const wk = weekSummary(data)
  const prev = weekSummary(data, new Date(), 1)
  const today = wk.days[6]
  const activeDays = wk.days.filter((d) => d.secs > 0).length || 1
  const avg = wk.total / activeDays
  const peak = Math.max(1, ...wk.days.map((d) => d.secs))
  const tr = trend(wk.total, prev.total)
  const report = buildReport(data)
  const send = async () => {
    const mail = await import('./Mail')
    mail.sendScreenTimeReport()
    os().openApp('mail')
  }
  return (
    <>
      <p className="set-intro">Measured for real: only time this tab is in front of you and you are actually moving the pointer or typing counts. Pear learns nothing from it and judges you anyway.</p>
      <div className="set-card st-hero">
        <small>Today</small>
        <b>{fmtDur(today.secs)}</b>
        <span>{wk.total < 60 ? shameToast(data) : verdict(today.secs)}</span>
      </div>
      <h4 className="set-head">This week</h4>
      <div className="set-card st-chart" role="img" aria-label={`Daily screen time: ${wk.days.map((d) => `${d.label} ${fmtDur(d.secs)}`).join(', ')}`}>
        {wk.days.map((d) => (
          <div key={d.key} className={`st-col ${d.key === dayKey() ? 'today' : ''}`}>
            <small>{d.secs >= 60 ? fmtDur(d.secs) : ''}</small>
            <i style={{ height: `${Math.max(2, (d.secs / peak) * 100)}%` }} />
            <small>{d.label}</small>
          </div>
        ))}
      </div>
      <div className="set-card st-stats">
        <div>
          <small>Daily average</small>
          <b>{fmtDur(avg)}</b>
          {tr && <em>{tr}</em>}
        </div>
        <div>
          <small>Total</small>
          <b>{fmtDur(wk.total)}</b>
        </div>
        <div>
          <small>Pickups</small>
          <b>{wk.pickups}</b>
        </div>
      </div>
      <h4 className="set-head">Apps</h4>
      <div className="set-card st-apps">
        {wk.apps.length === 0 && <div className="st-empty">Nothing yet. Use the computer a little, then come back to be judged.</div>}
        {wk.apps.slice(0, 8).map(([app, secs]) => (
          <div key={app} className="st-app">
            <span>{APP_NAMES[app]}</span>
            <div>
              <i style={{ width: `${(secs / wk.apps[0][1]) * 100}%` }} />
            </div>
            <b>{fmtDur(secs)}</b>
            <small>{Math.round((secs / wk.total) * 100)}%</small>
          </div>
        ))}
      </div>
      <div className="set-actions st-actions">
        <button className="btn" onClick={() => (sure ? (useScreenTime.getState().reset(), setSure(false)) : setSure(true))} onBlur={() => setSure(false)}>
          {sure ? 'Really erase it? The shame stays with you' : 'Erase Screen Time Data'}
        </button>
        <button className="btn primary" onClick={send} disabled={!report} title={report ? 'Mail it to yourself' : 'Needs a minute of data first'}>
          Email Me This Report
        </button>
      </div>
    </>
  )
}
