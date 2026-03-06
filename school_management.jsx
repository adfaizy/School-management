import { useState, useRef, useEffect } from "react";
import * as XLSX from "xlsx";
import { SUPABASE_ENABLED, loadSchools, upsertSchool, deleteSchool } from "./src/lib/supabase.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const C = { navy:"#1a3a6b", navyL:"#e8edf8", gold:"#f59e0b", green:"#16a34a", red:"#dc2626", gray:"#6b7280", grayL:"#f3f4f6", breakC:"#fbbf24", breakL:"#fef3c7" };
const RESULT_CARD_BORDER_URL = "assets/c__Users_HASEEB_AppData_Roaming_Cursor_User_workspaceStorage_f1c9bae2db74da0609014ed218c5be7d_images_result-card-border-863f0655-8f22-4752-bc24-93fe42f39e23.png";
const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2,6)}`;

// ─── DEFAULT DATA ─────────────────────────────────────────────────────────────
const defaultSettings = {
  schoolName: "",
  principalName: "",
  schoolCode: "",
  logo: null,
  institutionName: "",
  institutionAddress: "",
  classes: [],
  classSubjects: {},
  staff: [],
  commonTeachers: {},
  schoolHours: {
    mondayToThursday: { start:"08:40", end:"14:00" },
    friday:           { start:"08:40", end:"12:00" },
    saturday:         { start:"08:40", end:"13:00" },
  },
  assemblyTime: 15,
  firstPeriodTime: 40,
  otherPeriodTime: 30,
  periodsPerDay: 8,
  breakRequired: true,
  breakAfterPeriod: 5,
  breakDuration: 25,
  fridayBreak: false,
  fridayBreakAfter: 5,
  fridayBreakDuration: 0,
  passPercent: 50,
};

const defaultStudents = [];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function ordSfx(n){ if(n===1)return "st"; if(n===2)return "nd"; if(n===3)return "rd"; return "th"; }

function fmtMin(m){
  if(m===undefined||m===null) return "--";
  const h=Math.floor(m/60), mm=m%60;
  const sfx=h>=12?"PM":"AM", hh=h>12?h-12:h===0?12:h;
  return `${hh}:${String(mm).padStart(2,"0")} ${sfx}`;
}
function academicSession(d=new Date()){
  const y=d.getFullYear();
  const m=d.getMonth(); // 0-indexed
  // Session changes in April: e.g. Apr 2025 -> 2025-2026, Jan 2025 -> 2024-2025
  if(m>=3) return `${y}-${y+1}`;
  return `${y-1}-${y}`;
}

function calcTimes(settings, day){
  const isFri=day==="Friday", isSat=day==="Saturday";
  const key=isFri?"friday":isSat?"saturday":"mondayToThursday";
  const [h,m]=settings.schoolHours[key].start.split(":").map(Number);
  let mins=h*60+m;
  const assStart=mins, assEnd=mins+settings.assemblyTime;
  mins=assEnd;
  const brReq=isFri?settings.fridayBreak:settings.breakRequired;
  const brAfter=isFri?settings.fridayBreakAfter:settings.breakAfterPeriod;
  const brDur=isFri?settings.fridayBreakDuration:settings.breakDuration;
  const rows=[];
  for(let i=0;i<settings.periodsPerDay;i++){
    const s=mins, dur=i===0?settings.firstPeriodTime:settings.otherPeriodTime;
    mins+=dur;
    rows.push({isBreak:false, idx:i, start:s, end:mins});
    if(brReq&&(i+1)===brAfter){ rows.push({isBreak:true, start:mins, end:mins+brDur}); mins+=brDur; }
  }
  return {assStart, assEnd, rows};
}

function getTT(tt,cls,day,pi){ return tt?.[cls]?.[day]?.[pi]||{subject:"",teacher:""}; }
function setTT(setFn,cls,day,pi,val){ setFn(p=>({ ...p, [cls]:{ ...(p[cls]||{}), [day]:{ ...((p[cls]||{})[day]||{}), [pi]:val } } })); }

// ─── UI PRIMITIVES ────────────────────────────────────────────────────────────
function Btn({children,onClick,color,small,danger,outline,disabled,style:sx}){
  const bg=danger?C.red:outline?"transparent":(color||C.navy);
  const tc=outline?(color||C.navy):"#fff";
  const bd=outline?`1.5px solid ${color||C.navy}`:"none";
  return <button onClick={onClick} disabled={disabled} style={{background:bg,color:tc,border:bd,borderRadius:5,padding:small?"4px 10px":"7px 16px",fontSize:small?12:13,cursor:disabled?"not-allowed":"pointer",fontWeight:600,opacity:disabled?0.5:1,whiteSpace:"nowrap",...sx}}>{children}</button>;
}
function Sel({label,value,onChange,options,width}){
  return <div style={{display:"flex",flexDirection:"column",gap:3}}>
    {label&&<label style={{fontSize:11,fontWeight:700,color:C.gray,textTransform:"uppercase",letterSpacing:0.4}}>{label}</label>}
    <select value={value} onChange={e=>onChange(e.target.value)} style={{padding:"6px 8px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:13,background:"#fff",width:width||"auto",cursor:"pointer"}}>
      {options.map(o=><option key={typeof o==="string"?o:o.value} value={typeof o==="string"?o:o.value}>{typeof o==="string"?o:o.label}</option>)}
    </select>
  </div>;
}
function Inp({label,value,onChange,type="text",width,...rest}){
  return <div style={{display:"flex",flexDirection:"column",gap:3}}>
    {label&&<label style={{fontSize:11,fontWeight:700,color:C.gray,textTransform:"uppercase",letterSpacing:0.4}}>{label}</label>}
    <input type={type} value={value} onChange={e=>onChange(e.target.value)} style={{padding:"6px 8px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:13,width:width||"auto",boxSizing:"border-box"}} {...rest}/>
  </div>;
}

function SchoolHeader({settings,subtitle,rightText}){
  return <div style={{display:"flex",alignItems:"center",gap:14,padding:"10px 18px",borderBottom:`2px solid ${C.navy}`,marginBottom:10}}>
    {settings.logo?<img src={settings.logo} style={{width:48,height:48,borderRadius:"50%",objectFit:"cover"}}/>
      :<div style={{width:48,height:48,borderRadius:"50%",background:C.navy,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:700,fontSize:18,flexShrink:0}}>★</div>}
    <div style={{flex:1,textAlign:"center"}}>
      <div style={{fontWeight:700,fontSize:15,color:C.navy}}>{settings.schoolName}</div>
      {subtitle&&<div style={{fontSize:12,color:C.gray,marginTop:2}}>{subtitle}</div>}
    </div>
    <div style={{fontSize:11,color:C.gray,textAlign:"right"}}>
      {rightText
        ? (()=>{ const parts=String(rightText).split(" | "); return (
            <>
              {parts.map((p,i)=><div key={i} style={{fontWeight:i===0?700:500}}>{p}</div>)}
            </>
          );})()
        : <>
            <div>{new Date().toLocaleDateString("en-PK",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
            <div>{new Date().toLocaleTimeString("en-PK",{hour:"2-digit",minute:"2-digit"})}</div>
          </>}
    </div>
  </div>;
}

// ─── TIMETABLE CELL ───────────────────────────────────────────────────────────
function TTCell({subject,teacher,isCommon,busy,onOpen}){
  const hasAssign=!!(subject||teacher);
  return <div
    onClick={onOpen}
    role="button"
    tabIndex={0}
    onKeyDown={e=>e.key==="Enter"&&onOpen()}
    style={{padding:"3px 2px",minHeight:38,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}
  >
    {hasAssign
      ? (
        <div style={{textAlign:"center"}}>
          <div style={{fontWeight:700,fontSize:12}}>{subject}</div>
          <div style={{fontSize:10,marginTop:1}}>{teacher||""}</div>
        </div>
      )
      : (
        <div className="tt-empty-plus" style={{fontWeight:700,fontSize:16}}>+</div>
      )}
  </div>;
}

// ─── ALL CLASSES VIEW ─────────────────────────────────────────────────────────
function AllClassesView({settings,timetable,setTimetable,day}){
  const {rows} = calcTimes(settings,day);
  const pRows = rows.filter(r=>!r.isBreak);
  const brRow = rows.find(r=>r.isBreak);

  const [editCell,setEditCell]=useState(null); // {cid,pi}
  const [editSubject,setEditSubject]=useState("");
  const [editTeacher,setEditTeacher]=useState("");

  function teacherBusy(teacher,pi,excludeCls){
    if(!teacher) return false;
    return settings.classes.some(c=>c.id!==excludeCls&&getTT(timetable,c.id,day,pi).teacher===teacher);
  }
  function subjectUsed(cid,subj,excludePi){
    if(!subj) return false;
    return pRows.some((_,i)=>i!==excludePi&&getTT(timetable,cid,day,i).subject===subj);
  }
  function applyCommon(cid,pi,subject,teacher){
    const cls=settings.classes.find(c=>c.id===cid); if(!cls) return;
    const common=settings.commonTeachers?.[cls.grade]||{};
    const normSubj=(subject||"").trim();
    if(!normSubj||!common[normSubj]||!teacher) return;
    settings.classes.filter(c=>c.grade===cls.grade&&c.id!==cid).forEach(sc=>{
      if((settings.classSubjects[sc.id]||[]).some(s=>(s||"").trim()===normSubj)){
        const existing=getTT(timetable,sc.id,day,pi);
        if(!existing.subject && !existing.teacher){
          setTT(setTimetable,sc.id,day,pi,{subject:normSubj,teacher,isCommon:true});
        }
      }
    });
  }
  function handleChange(cid,pi,field,value){
    const prev=getTT(timetable,cid,day,pi);
    const next={...prev,[field]:value};
    setTT(setTimetable,cid,day,pi,next);
    if(field==="teacher") applyCommon(cid,pi,next.subject,next.teacher);
  }

  const brAfterIdx = settings.breakRequired ? settings.breakAfterPeriod-1 : -1;

  const openEditor=(cid,pi)=>{
    const cell=getTT(timetable,cid,day,pi);
    setEditCell({cid,pi});
    setEditSubject(cell.subject||"");
    setEditTeacher(cell.teacher||"");
  };
  const closeEditor=()=>{ setEditCell(null); };
  const saveEditor=()=>{
    if(!editCell) return;
    if(!editSubject){ alert("Please select a subject before saving this period."); return; }
    if(!editTeacher){ alert("Please select a teacher before saving this period."); return; }
    const {cid,pi}=editCell;
    // Write subject+teacher together so they can't overwrite each other
    const next={subject:editSubject,teacher:editTeacher};
    setTT(setTimetable,cid,day,pi,next);
    applyCommon(cid,pi,next.subject,next.teacher);
    setEditCell(null);
  };

  const renderModal=()=>{
    if(!editCell) return null;
    const {cid,pi}=editCell;
    const cls=settings.classes.find(c=>c.id===cid);
    const subjects=settings.classSubjects[cid]||[];
    const period=pRows[pi];
    const currentCell=getTT(timetable,cid,day,pi);
    const subjectOptions=subjects.filter(s=>!subjectUsed(cid,s,pi)||s===currentCell.subject);
    const gradeCommon=settings.commonTeachers?.[cls?.grade]||{};
    const effectiveSubject=(editSubject||currentCell.subject||"").trim();
    const isCommonSubject=!!gradeCommon[effectiveSubject];
    const teacherOptions=settings.staff.filter(st=>{
      const isCurrent=st.name===currentCell.teacher;
      if(isCurrent) return true;

      // Check where this teacher is already assigned in this period
      let busySameGrade=false;
      let busyOtherGrade=false;
      settings.classes.forEach(c=>{
        if(c.id===cid) return;
        const cell=getTT(timetable,c.id,day,pi);
        if(cell.teacher===st.name){
          if(c.grade===cls?.grade) busySameGrade=true;
          else busyOtherGrade=true;
        }
      });

      if(isCommonSubject){
        // For common subjects, allow the teacher in multiple sections
        // of the SAME grade, but NOT in other grades.
        return !busyOtherGrade;
      }

      // For normal subjects, teacher cannot be busy anywhere else
      return !(busySameGrade||busyOtherGrade);
    });
    return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={closeEditor}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:420,maxHeight:"90vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{background:C.navy,color:"#fff",padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontWeight:700,fontSize:14}}>Assign Period</span>
          <button onClick={closeEditor} style={{background:"none",border:"none",color:"#fff",fontSize:20,cursor:"pointer"}}>×</button>
        </div>
        <div style={{padding:16,fontSize:13}}>
          <div style={{marginBottom:8,color:C.gray}}>
            <div><strong>Class:</strong> {cls?.name}</div>
            <div><strong>Period:</strong> {pi+1}{ordSfx(pi+1)} ({fmtMin(period.start)}–{fmtMin(period.end)})</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr",gap:8,marginBottom:12}}>
            <div>
              <label style={{fontSize:11,fontWeight:700,color:C.gray,display:"block",marginBottom:4}}>Subject</label>
              <select value={editSubject} onChange={e=>setEditSubject(e.target.value)} style={{width:"100%",padding:"6px 8px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:13}}>
                <option value="">— Select subject —</option>
                {subjectOptions.map(s=>{
                  const isCommon = !!gradeCommon[(s||"").trim()];
                  return <option key={s} value={s}>{isCommon?"★ ":""}{s}</option>;
                })}
              </select>
            </div>
            <div>
              <label style={{fontSize:11,fontWeight:700,color:C.gray,display:"block",marginBottom:4}}>Teacher</label>
              <select value={editTeacher} onChange={e=>setEditTeacher(e.target.value)} disabled={!editSubject} style={{width:"100%",padding:"6px 8px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:13,background:editSubject?"#fff":"#f3f4f6",opacity:editSubject?1:0.7}}>
                <option value="">— Select teacher —</option>
                {teacherOptions.map(st=><option key={st.id} value={st.name}>{st.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <button
              onClick={()=>{
                if(!editCell) return;
                const {cid,pi}=editCell;
                setEditSubject("");
                setEditTeacher("");
                setTT(setTimetable,cid,day,pi,{subject:"",teacher:""});
                setEditCell(null);
              }}
              style={{background:"none",border:"none",color:C.red,fontSize:12,cursor:"pointer"}}
            >
              Clear
            </button>
            <div style={{display:"flex",gap:8}}>
              <Btn outline color={C.gray} onClick={closeEditor}>Cancel</Btn>
              <Btn onClick={saveEditor}>Save</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>;
  };

  return <div style={{overflowX:"auto"}}>
    <table style={{borderCollapse:"collapse",fontSize:11,minWidth:900}}>
      <thead>
        <tr>
          <th style={{background:C.navy,color:"#fff",padding:"6px 8px",minWidth:88,position:"sticky",left:0,zIndex:2,fontSize:12}}>Class</th>
          {pRows.map((p,i)=>[
            <th key={`ph${i}`} style={{background:C.navy,color:"#fff",padding:"4px 5px",minWidth:88,textAlign:"center"}}>
              <div style={{fontWeight:700}}>{i+1}{ordSfx(i+1)}</div>
              <div style={{fontSize:9,fontWeight:400,opacity:0.85}}>{fmtMin(p.start)}–{fmtMin(p.end)}</div>
            </th>,
            i===brAfterIdx&&brRow&&<th key={`bh${i}`} style={{background:C.breakC,color:"#78350f",padding:"4px 5px",minWidth:58,textAlign:"center",fontWeight:700,fontSize:10}}>Break<br/><span style={{fontWeight:400,fontSize:9}}>{fmtMin(brRow.start)}–{fmtMin(brRow.end)}</span></th>
          ])}
        </tr>
      </thead>
      <tbody>
        {settings.classes.map((cls,ri)=>{
          const subjects=settings.classSubjects[cls.id]||[];
          const gradeCommon=settings.commonTeachers?.[cls.grade]||{};
          return <tr key={cls.id} style={{background:ri%2===0?"#f9fafb":"#fff"}}>
            <td style={{padding:"4px 8px",fontWeight:700,color:C.navy,background:ri%2===0?"#e8edf8":"#eef2fc",position:"sticky",left:0,zIndex:1,fontSize:12,whiteSpace:"nowrap"}}>{cls.name}</td>
            {pRows.map((p,pi)=>{
              const cell=getTT(timetable,cls.id,day,pi);
              const busy=teacherBusy(cell.teacher,pi,cls.id);
              const isCommon=!!(cell.subject&&gradeCommon[cell.subject]);
              return [
                <td key={`c${pi}`} style={{padding:2,minWidth:88,border:"1px solid #e5e7eb",verticalAlign:"top"}}>
                  <TTCell subject={cell.subject} teacher={cell.teacher}
                    isCommon={isCommon} busy={busy}
                    onOpen={()=>openEditor(cls.id,pi)}/>
                </td>,
                pi===brAfterIdx&&<td key={`b${pi}`} style={{background:C.breakL,textAlign:"center",fontWeight:700,fontSize:10,color:"#92400e",padding:"3px 2px",minWidth:58}}>BREAK</td>
              ];
            })}
          </tr>;
        })}
      </tbody>
    </table>
    {renderModal()}
  </div>;
}

// ─── ALL CLASSES VIEW (single table for all days) ─────────────────────────────
function AllClassesAllDaysView({settings,timetable,setTimetable}){
  const {rows} = calcTimes(settings,"Monday");
  const pRows = rows.filter(r=>!r.isBreak);
  const brRow = rows.find(r=>r.isBreak);
  const brAfterIdx = settings.breakRequired ? settings.breakAfterPeriod-1 : -1;

  function teacherBusy(teacher,day,pi,excludeCls){
    if(!teacher) return false;
    return settings.classes.some(c=>c.id!==excludeCls&&getTT(timetable,c.id,day,pi).teacher===teacher);
  }
  function subjectUsed(cid,subj,day,excludePi){
    if(!subj) return false;
    return pRows.some((_,i)=>i!==excludePi&&getTT(timetable,cid,day,i).subject===subj);
  }
  function applyCommon(cid,day,pi,subject,teacher){
    const cls=settings.classes.find(c=>c.id===cid); if(!cls) return;
    const common=settings.commonTeachers?.[cls.grade]||{};
    if(!subject||!common[subject]) return;
    settings.classes.filter(c=>c.grade===cls.grade&&c.id!==cid).forEach(sc=>{
      if((settings.classSubjects[sc.id]||[]).includes(subject))
        setTT(setTimetable,sc.id,day,pi,{subject,teacher,isCommon:true});
    });
  }
  function handleChange(cid,day,pi,field,value){
    const prev=getTT(timetable,cid,day,pi);
    const next={...prev,[field]:value};
    setTT(setTimetable,cid,day,pi,next);
    if(field==="teacher"||field==="subject") applyCommon(cid,day,pi,next.subject,next.teacher);
  }

  return <div style={{overflowX:"auto"}}>
    <table style={{borderCollapse:"collapse",fontSize:11,minWidth:900}}>
      <thead>
        <tr>
          <th style={{background:C.navy,color:"#fff",padding:"6px 8px",minWidth:88,position:"sticky",left:0,zIndex:2,fontSize:12}}>Class</th>
          {pRows.map((p,i)=>[
            <th key={`ph${i}`} style={{background:C.navy,color:"#fff",padding:"4px 5px",minWidth:88,textAlign:"center"}}>
              <div style={{fontWeight:700}}>{i+1}{ordSfx(i+1)}</div>
              <div style={{fontSize:9,fontWeight:400,opacity:0.85}}>{fmtMin(p.start)}–{fmtMin(p.end)}</div>
            </th>,
            i===brAfterIdx&&brRow&&<th key={`bh${i}`} style={{background:C.breakC,color:"#78350f",padding:"4px 5px",minWidth:58,textAlign:"center",fontWeight:700,fontSize:10}}>Break<br/><span style={{fontWeight:400,fontSize:9}}>{fmtMin(brRow.start)}–{fmtMin(brRow.end)}</span></th>
          ])}
        </tr>
      </thead>
      <tbody>
        {settings.classes.flatMap((cls,ri)=>{
          const subjects=settings.classSubjects[cls.id]||[];
          const gradeCommon=settings.commonTeachers?.[cls.grade]||{};
          return DAYS.map((day,di)=>{
            const rowIdx=ri*DAYS.length+di;
            return <tr key={`${cls.id}_${day}`} style={{background:rowIdx%2===0?"#f9fafb":"#fff"}}>
              {di===0&&<td rowSpan={DAYS.length} style={{padding:"4px 8px",fontWeight:700,color:C.navy,background:"#e8edf8",position:"sticky",left:0,zIndex:1,fontSize:12,whiteSpace:"nowrap",verticalAlign:"middle"}}>{cls.name}</td>}
              {pRows.map((p,pi)=>{
                const cell=getTT(timetable,cls.id,day,pi);
                const busy=teacherBusy(cell.teacher,day,pi,cls.id);
                const isCommon=!!(cell.subject&&gradeCommon[cell.subject]);
                return [
                  <td key={`c${pi}`} style={{padding:2,minWidth:88,border:"1px solid #e5e7eb",verticalAlign:"top"}}>
                    <TTCell subject={cell.subject} teacher={cell.teacher} subjects={subjects} staff={settings.staff}
                      isCommon={isCommon} busy={busy}
                      onSubj={v=>handleChange(cls.id,day,pi,"subject",v)}
                      onTeach={v=>handleChange(cls.id,day,pi,"teacher",v)}/>
                  </td>,
                  pi===brAfterIdx&&<td key={`b${pi}`} style={{background:C.breakL,textAlign:"center",fontWeight:700,fontSize:10,color:"#92400e",padding:"3px 2px",minWidth:58}}>BREAK</td>
                ];
              })}
            </tr>;
          });
        })}
      </tbody>
    </table>
  </div>;
}

// ─── TEACHERS VIEW ────────────────────────────────────────────────────────────
function TeachersView({settings,timetable,day}){
  const {rows} = calcTimes(settings,day);
  const pRows = rows.filter(r=>!r.isBreak);
  const brAfterIdx = settings.breakRequired ? settings.breakAfterPeriod-1 : -1;

  function getAssignment(tName,pi){
    for(const cls of settings.classes){
      const cell=getTT(timetable,cls.id,day,pi);
      if(cell.teacher===tName) return {subject:cell.subject,className:cls.name};
    }
    return null;
  }
  function countPeriods(tName){
    return pRows.reduce((acc,_,pi)=>acc+(getAssignment(tName,pi)?1:0),0);
  }

  return <div style={{overflowX:"auto"}}>
    <div className="print-only" style={{display:"none",marginBottom:8}}>
      <SchoolHeader settings={settings} subtitle="TEACHERS TIMETABLE"/>
    </div>
    <table style={{borderCollapse:"collapse",fontSize:11,minWidth:700}}>
      <thead>
        <tr>
          <th style={{background:C.navy,color:"#fff",padding:"6px 8px",minWidth:100,position:"sticky",left:0,zIndex:2}}>Teacher</th>
          {pRows.map((p,i)=>[
            <th key={`th${i}`} style={{background:C.navy,color:"#fff",padding:"4px 5px",minWidth:80,textAlign:"center"}}>
              <div>{i+1}{ordSfx(i+1)}</div>
              <div style={{fontSize:9,fontWeight:400}}>{fmtMin(p.start)}–{fmtMin(p.end)}</div>
            </th>,
            i===brAfterIdx&&<th key={`tbh${i}`} style={{background:C.breakC,color:"#78350f",padding:"4px 5px",minWidth:55,textAlign:"center",fontWeight:700,fontSize:10}}>Break</th>
          ])}
          <th style={{background:C.navy,color:"#fff",padding:"6px 8px",minWidth:65,textAlign:"center"}}>Periods/Day</th>
        </tr>
      </thead>
      <tbody>
        {settings.staff.map((teacher,ri)=>{
          const count=countPeriods(teacher.name);
          return <tr key={teacher.id} style={{background:ri%2===0?"#f9fafb":"#fff"}}>
            <td style={{padding:"4px 8px",fontWeight:700,color:C.navy,background:ri%2===0?"#e8edf8":"#eef2fc",position:"sticky",left:0,zIndex:1,whiteSpace:"nowrap"}}>
              {teacher.name}<div style={{fontSize:9,color:C.gray,fontWeight:400}}>{teacher.designation}</div>
            </td>
            {pRows.map((_,pi)=>{
              const assigned=getAssignment(teacher.name,pi);
              return [
                <td key={`tc${pi}`} style={{padding:3,border:"1px solid #e5e7eb",textAlign:"center",minWidth:80}}>
                  {assigned?(<div style={{background:"#dbeafe",border:"1px solid #93c5fd",borderRadius:4,padding:"3px 4px"}}>
                    <div style={{fontWeight:700,color:C.navy,fontSize:11}}>{assigned.subject}</div>
                    <div style={{fontSize:10,color:C.gray}}>{assigned.className}</div>
                  </div>):<span style={{color:"#d1d5db",fontSize:10}}>Free</span>}
                </td>,
                pi===brAfterIdx&&<td key={`tb${pi}`} style={{background:C.breakL,textAlign:"center",fontWeight:700,fontSize:10,color:"#92400e",padding:2}}>BREAK</td>
              ];
            })}
            <td style={{textAlign:"center",fontWeight:700,fontSize:16,color:count>0?C.navy:C.gray}}>{count||"—"}</td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}

// ─── BY CLASS VIEW ────────────────────────────────────────────────────────────
function ByClassView({settings,timetable,selCls}){
  const {rows:monRows} = calcTimes(settings,"Monday");
  const pRows = monRows.filter(r=>!r.isBreak);
  const brRow = monRows.find(r=>r.isBreak);
  const brAfterIdx = settings.breakRequired ? settings.breakAfterPeriod-1 : -1;
  const cls=settings.classes.find(c=>c.id===selCls);
  return <div>
    <div className="print-only" style={{display:"none",marginBottom:8}}>
      <SchoolHeader settings={settings} subtitle={`${cls?.name||""} — CLASS TIMETABLE`}/>
    </div>
    <div style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse",fontSize:11,width:"100%"}}>
          <thead>
            <tr>
              <th style={{background:C.navy,color:"#fff",padding:"6px 10px",minWidth:80}}>Day</th>
              {pRows.map((_,i)=>[
                <th key={`bch${i}`} style={{background:C.navy,color:"#fff",padding:"4px 6px",minWidth:80,textAlign:"center"}}>{i+1}{ordSfx(i+1)}</th>,
                i===brAfterIdx&&<th key={`bcbh${i}`} style={{background:C.breakC,color:"#78350f",padding:"4px 6px",minWidth:50,fontWeight:700,fontSize:10,textAlign:"center"}}>Break</th>
              ])}
            </tr>
            <tr>
              <th style={{background:"#e8edf8",padding:"4px 10px",color:C.navy,fontSize:11}}>Time</th>
              {pRows.map((p,i)=>[
                <th key={`bct${i}`} style={{background:"#e8edf8",padding:"3px 5px",textAlign:"center",fontSize:10,fontWeight:600,color:C.gray}}>{fmtMin(p.start)}–{fmtMin(p.end)}</th>,
                i===brAfterIdx&&brRow&&<th key={`bcbt${i}`} style={{background:C.breakL,padding:"3px 5px",textAlign:"center",fontSize:10,fontWeight:600,color:"#92400e"}}>{fmtMin(brRow.start)}–{fmtMin(brRow.end)}</th>
              ])}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((day,di)=>{
              const {rows} = calcTimes(settings,day);
              const dp = rows.filter(r=>!r.isBreak);
              return <tr key={day} style={{background:di%2===0?"#f9fafb":"#fff"}}>
                <td style={{padding:"5px 10px",fontWeight:700,color:C.navy,background:di%2===0?"#e8edf8":"#eef2fc"}}>{day}</td>
                {dp.map((_,pi)=>{
                  const cell=getTT(timetable,selCls,day,pi);
                  return [
                    <td key={`byc${pi}`} style={{padding:4,border:"1px solid #e5e7eb",textAlign:"center",minWidth:80}}>
                      {cell.subject?<><div style={{fontWeight:700,color:C.navy,fontSize:11}}>{cell.subject}</div><div style={{fontSize:10,color:C.gray}}>{cell.teacher}</div></>:<span style={{color:"#d1d5db",fontSize:10}}>—</span>}
                    </td>,
                    pi===brAfterIdx&&<td key={`bycb${pi}`} style={{background:C.breakL,textAlign:"center",fontWeight:700,fontSize:10,color:"#92400e",padding:2}}>BREAK</td>
                  ];
                })}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
  </div>;
}

// ─── BY TEACHER VIEW ──────────────────────────────────────────────────────────
function ByTeacherView({settings,timetable,selT}){
  const teacher=settings.staff.find(st=>st.name===selT);
  const {rows:monRows} = calcTimes(settings,"Monday");
  const {rows:friRows} = calcTimes(settings,"Friday");
  const monP = monRows.filter(r=>!r.isBreak);
  const friP = friRows.filter(r=>!r.isBreak);
  const monBr = monRows.find(r=>r.isBreak);
  const friBr = friRows.find(r=>r.isBreak);

  function getAssign(day,pi){
    for(const cls of settings.classes){
      const cell=getTT(timetable,cls.id,day,pi);
      if(cell.teacher===selT) return {subject:cell.subject,className:cls.name,grade:cls.grade};
    }
    return null;
  }
  const monAssigns = monP.map((_,pi)=>getAssign("Monday",pi));
  const totalP = monAssigns.filter(Boolean).length;

  // Incharge: first period — show class only (e.g. Class-9 or 9th), not section
  const incharge = (() => {
    const a=monAssigns[0];
    if(!a||!a.grade) return a?a.className:"—";
    const g=String(a.grade).trim();
    return g ? `Class-${g}` : (a.className||"—");
  })();

  return <div className="by-teacher-print">
    <div style={{overflow:"hidden",background:"#fff"}}>
      <div className="print-only" style={{display:"none",marginBottom:8}}>
        <SchoolHeader settings={settings} subtitle="TEACHERS TIMETABLE"/>
      </div>
      {/* Info bar */}
      <div style={{padding:"10px 16px",borderBottom:`1px solid #e5e7eb`,fontSize:12,display:"flex",justifyContent:"center",alignItems:"center",gap:16,flexWrap:"wrap"}}>
        <span>Name: <span style={{fontWeight:700,textTransform:"uppercase"}}>{teacher?.name}</span></span>
        <span>|</span>
        <span>Designation: <span style={{fontWeight:700,textTransform:"uppercase"}}>{teacher?.designation}</span></span>
        <span>|</span>
        <span>Incharge: <span style={{fontWeight:700,textTransform:"uppercase"}}>{incharge}</span></span>
        <span>|</span>
        <span>Periods/Day: <span style={{fontWeight:700}}>{totalP}</span></span>
      </div>

      {/* Schedule table */}
      <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",fontSize:11,width:"100%"}}>
          <thead>
            <tr style={{background:C.navy,color:"#fff"}}>
              <th style={{padding:"5px 8px",textAlign:"left",minWidth:70}}>Periods</th>
              <th colSpan={2} style={{padding:"5px 8px",textAlign:"center",borderLeft:"1px solid #2563eb"}}>MONDAY TO THURSDAY</th>
              <th colSpan={2} style={{padding:"5px 8px",textAlign:"center",borderLeft:"1px solid #2563eb"}}>FRIDAY</th>
              <th style={{padding:"5px 8px",textAlign:"center",borderLeft:"1px solid #2563eb",minWidth:120}}>CLASS–SUBJECT</th>
            </tr>
            <tr style={{background:"#e8edf8"}}>
              <th style={{padding:"4px 8px",fontWeight:700,color:C.navy}}>Periods</th>
              <th style={{padding:"4px 8px",fontWeight:600,color:C.navy,textAlign:"center"}}>S.Time</th>
              <th style={{padding:"4px 8px",fontWeight:600,color:C.navy,textAlign:"center"}}>E.Time</th>
              <th style={{padding:"4px 8px",fontWeight:600,color:C.navy,textAlign:"center"}}>S.Time</th>
              <th style={{padding:"4px 8px",fontWeight:600,color:C.navy,textAlign:"center"}}>E.Time</th>
              <th style={{padding:"4px 8px",fontWeight:600,color:C.navy,textAlign:"center"}}>CLASS–SUBJECT</th>
            </tr>
          </thead>
          <tbody>
            {/* Assembly */}
            <tr style={{background:"#f0f4fc"}}>
              <td style={{padding:"4px 8px",fontWeight:600}}>Assembly</td>
              <td style={{padding:"4px 8px",textAlign:"center"}}>{fmtMin(monP[0]?.start-settings.assemblyTime)}</td>
              <td style={{padding:"4px 8px",textAlign:"center"}}>{fmtMin(monP[0]?.start)}</td>
              <td style={{padding:"4px 8px",textAlign:"center"}}>{fmtMin(friP[0]?.start-settings.assemblyTime)}</td>
              <td style={{padding:"4px 8px",textAlign:"center"}}>{fmtMin(friP[0]?.start)}</td>
              <td></td>
            </tr>
            {monP.map((mp,pi)=>{
              const fp=friP[pi];
              const monAssign=monAssigns[pi];
              const isBreakRow=settings.breakRequired&&pi===settings.breakAfterPeriod;
              return [
                isBreakRow&&<tr key={`br${pi}`} style={{background:C.breakL}}>
                  <td style={{padding:"4px 8px",fontWeight:700,color:"#92400e"}}>Break</td>
                  <td style={{padding:"4px 8px",textAlign:"center",color:"#92400e"}}>{monBr?fmtMin(monBr.start):"—"}</td>
                  <td style={{padding:"4px 8px",textAlign:"center",color:"#92400e"}}>{monBr?fmtMin(monBr.end):"—"}</td>
                  <td colSpan={2} style={{padding:"4px 8px",textAlign:"center",color:"#92400e",fontStyle:"italic"}}>
                    {settings.fridayBreak&&friBr?`${fmtMin(friBr.start)} – ${fmtMin(friBr.end)}`:"No Break"}
                  </td>
                  <td></td>
                </tr>,
                <tr key={pi} style={{background:pi%2===0?"#f9fafb":"#fff"}}>
                  <td style={{padding:"4px 8px",fontWeight:600}}>{pi+1}{ordSfx(pi+1)}</td>
                  <td style={{padding:"4px 8px",textAlign:"center"}}>{fmtMin(mp.start)}</td>
                  <td style={{padding:"4px 8px",textAlign:"center"}}>{fmtMin(mp.end)}</td>
                  <td style={{padding:"4px 8px",textAlign:"center"}}>{fp?fmtMin(fp.start):"—"}</td>
                  <td style={{padding:"4px 8px",textAlign:"center"}}>{fp?fmtMin(fp.end):"—"}</td>
                  <td style={{padding:"4px 8px",textAlign:"center"}}>
                    {monAssign?(<div style={{background:"#dbeafe",border:"1px solid #93c5fd",borderRadius:4,padding:"2px 8px",display:"inline-block"}}>
                      <span style={{fontWeight:700,color:C.navy,fontSize:11}}>{monAssign.className}</span><br/>
                      <span style={{fontSize:10,color:C.gray}}>{monAssign.subject}</span>
                    </div>):<span style={{color:"#d1d5db"}}>—</span>}
                  </td>
                </tr>
              ];
            })}
          </tbody>
        </table>
      </div>

      {/* Footer summary */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",borderTop:`1px solid #e5e7eb`,background:"#f9fafb"}}>
        {[
          {label:"Monday to Thursday and Saturday",rows:[
            ["Assembly",`${settings.assemblyTime} minutes`],
            ["1st Period",`${settings.firstPeriodTime} minutes`],
            [`2nd to ${settings.periodsPerDay}th`,`${settings.otherPeriodTime} minutes`],
            ["Break",settings.breakRequired?`${settings.breakDuration} minutes`:"No Break"],
          ]},
          {label:"Friday",rows:[
            ["Assembly",`${settings.assemblyTime} minutes`],
            ["1st Period",`${settings.firstPeriodTime} minutes`],
            ["2nd to 5th",`${settings.otherPeriodTime} minutes`],
            ["Break",settings.fridayBreak?`${settings.fridayBreakDuration} minutes`:"0 minutes"],
          ]},
        ].map(col=>(
          <div key={col.label} style={{padding:"8px 16px",borderRight:"1px solid #e5e7eb"}}>
            <div style={{fontWeight:700,color:C.navy,marginBottom:5,fontSize:12}}>{col.label}</div>
            {col.rows.map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"2px 0",borderBottom:"1px dotted #e5e7eb"}}>
                <span style={{fontWeight:k==="Break"?700:400,color:k==="Break"?"#92400e":"#374151"}}>{k}</span>
                <span style={{fontWeight:k==="Break"?700:400,color:k==="Break"?"#92400e":"#374151"}}>{v}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{padding:"6px 16px",borderTop:"1px solid #e5e7eb",fontSize:10,color:C.gray,textAlign:"center",fontStyle:"italic"}}>
        The teacher will arrive <strong>15 minutes before school starts</strong>. School: Mon–Thu {settings.schoolHours.mondayToThursday.start}–{settings.schoolHours.mondayToThursday.end} | Friday {settings.schoolHours.friday.start}–{settings.schoolHours.friday.end}
      </div>
    </div>
  </div>;
}

// ─── TIMETABLE PAGE ───────────────────────────────────────────────────────────
function TimetablePage({settings,timetable,setTimetable}){
  const [view,setView]=useState("allClasses");
  const [byClassCls,setByClassCls]=useState(settings.classes[0]?.id||"");
  const [byTeacherName,setByTeacherName]=useState(settings.staff[0]?.name||"");
  const [printAllTeachers,setPrintAllTeachers]=useState(false);
  const [printAllClasses,setPrintAllClasses]=useState(false);

  const views=[{id:"allClasses",label:"All Classes"},{id:"teachers",label:"Teachers"},{id:"byClass",label:"By Class"},{id:"byTeacher",label:"By Teacher"}];

  const handlePrintAllTeachers=()=>{
    if(!settings.staff.length){ alert("No staff to print."); return; }
    setPrintAllTeachers(true);
    document.body.classList.add("printing-all-teachers");
    const cleanup=()=>{ setPrintAllTeachers(false); document.body.classList.remove("printing-all-teachers"); };
    window.addEventListener("afterprint",cleanup,{once:true});
    setTimeout(()=>window.print(),100);
  };
  const handlePrintAllClasses=()=>{
    if(!settings.classes.length){ alert("No classes to print."); return; }
    setPrintAllClasses(true);
    document.body.classList.add("printing-all-classes");
    const cleanup=()=>{ setPrintAllClasses(false); document.body.classList.remove("printing-all-classes"); };
    window.addEventListener("afterprint",cleanup,{once:true});
    setTimeout(()=>window.print(),100);
  };

  return <div>
    {/* Toolbar */}
    <div className="no-print" style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap",padding:"10px 14px",background:"#fff",borderRadius:8,boxShadow:"0 1px 4px rgba(0,0,0,0.08)"}}>
      <div style={{display:"flex",gap:4}}>
        {views.map(v=>(
          <button key={v.id} onClick={()=>setView(v.id)} style={{padding:"5px 14px",borderRadius:5,border:"none",background:view===v.id?C.navy:"#e5e7eb",color:view===v.id?"#fff":"#374151",fontWeight:600,fontSize:12,cursor:"pointer"}}>{v.label}</button>
        ))}
      </div>
      <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
        {view==="byClass"&&(
          <>
            <Sel value={byClassCls} onChange={setByClassCls} options={settings.classes.map(c=>({value:c.id,label:c.name}))}/>
            <Btn small outline onClick={handlePrintAllClasses}>🖨️ Print All</Btn>
          </>
        )}
        {view==="byTeacher"&&(
          <>
            <Sel value={byTeacherName} onChange={setByTeacherName} options={settings.staff.map(st=>({value:st.name,label:st.name}))}/>
            <Btn small outline onClick={handlePrintAllTeachers}>🖨️ Print All</Btn>
          </>
        )}
        <Btn small onClick={()=>window.print()}>🖨️ Print</Btn>
      </div>
    </div>

    {view==="allClasses"&&<div className="print-only" style={{display:"none",marginBottom:12}}>
      <SchoolHeader settings={settings} subtitle="ALL CLASSES — TIMETABLE"/>
    </div>}

    {view==="allClasses"&&<AllClassesView settings={settings} timetable={timetable} setTimetable={setTimetable} day="Monday"/>}
    {view==="teachers"&&<TeachersView settings={settings} timetable={timetable} day="Monday"/>}
    {view==="byClass"&&<div className="by-class-single"><ByClassView settings={settings} timetable={timetable} selCls={byClassCls}/></div>}
    {view==="byClass"&&printAllClasses&&settings.classes.length>0&&(
      <div className="print-only by-class-print-all" style={{display:"none"}}>
        {settings.classes.map(cls=>(
          <div key={cls.id} style={{pageBreakAfter:"always"}}>
            <ByClassView settings={settings} timetable={timetable} selCls={cls.id}/>
          </div>
        ))}
      </div>
    )}
    {view==="byTeacher"&&<div className="by-teacher-single"><ByTeacherView settings={settings} timetable={timetable} selT={byTeacherName}/></div>}
    {view==="byTeacher"&&printAllTeachers&&settings.staff.length>0&&(
      <div className="print-only by-teacher-print-all" style={{display:"none"}}>
        {settings.staff.map(st=>(
          <div key={st.name} style={{pageBreakAfter:"always"}}>
            <ByTeacherView settings={settings} timetable={timetable} selT={st.name}/>
          </div>
        ))}
      </div>
    )}
  </div>;
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────────
function ClassSubjCard({cls,subjects,onAdd,onRemove,onRemoveClass}){
  const [ns,setNs]=useState("");
  return <div style={{background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,padding:12}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
      <span style={{fontWeight:700,color:C.navy,fontSize:13}}>
        <span style={{fontSize:11,color:C.gray,marginRight:4}}>{cls.id}</span>
        {cls.name}{" "}
        <span style={{fontSize:10,color:C.gray}}>({cls.grade}{cls.section?`/${cls.section}`:""})</span>
      </span>
      <Btn small danger onClick={onRemoveClass}>×</Btn>
    </div>
    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
      {subjects.map(s=><span key={s} style={{background:"#dbeafe",color:"#1e40af",borderRadius:20,padding:"2px 8px",fontSize:11,display:"flex",alignItems:"center",gap:3}}>
        {s}<button onClick={()=>onRemove(s)} style={{background:"none",border:"none",cursor:"pointer",color:"#1e40af",padding:0,fontWeight:700}}>×</button>
      </span>)}
    </div>
    <div style={{display:"flex",gap:6}}>
      <input value={ns} onChange={e=>setNs(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){onAdd(ns);setNs("");}}} placeholder="Add subject…"
        style={{flex:1,padding:"4px 8px",border:"1px solid #d1d5db",borderRadius:4,fontSize:12}}/>
      <Btn small onClick={()=>{onAdd(ns);setNs("");}}>+</Btn>
    </div>
  </div>;
}

function CommonTeachersEditor({settings,setSettings}){
  // Only consider classes that have a section (i.e. multiple sections per grade)
  const grades=[...new Set(settings.classes.filter(c=>c.section).map(c=>c.grade))];
  const getC=(g,s)=>settings.commonTeachers?.[g]?.[s]||false;
  const setC=(g,s,t)=>setSettings(prev=>({...prev,commonTeachers:{...prev.commonTeachers,[g]:{...(prev.commonTeachers?.[g]||{}),[s]:t}}}));
  return <div>
    <p style={{fontSize:13,color:C.gray,marginTop:0}}>Assign a common teacher for a subject shared across all sections of the same grade. Auto-fills other sections when you assign in the timetable.</p>
    {grades.map(grade=>{
      const gClasses=settings.classes.filter(c=>c.grade===grade && c.section);
      if(gClasses.length<1) return null;
      // All subjects from classes that have a section (no duplicate filtering by sections now)
      const allSubjs=[...new Set(
        gClasses.flatMap(cls=>(settings.classSubjects[cls.id]||[]).map(s=>(s||"").trim()).filter(Boolean))
      )];
      return <div key={grade} style={{background:"#f9fafb",border:"1px solid #e5e7eb",borderRadius:8,padding:14,marginBottom:12}}>
        <h4 style={{margin:"0 0 10px",color:C.navy}}>Grade {grade} — Sections: {gClasses.map(c=>c.name).join(", ")}</h4>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
          {allSubjs.map(subj=>{
            const isCommon=!!getC(grade,subj);
            return <div key={subj} style={{display:"flex",flexDirection:"row",alignItems:"center",gap:6}}>
              <input type="checkbox" checked={isCommon} onChange={e=>setC(grade,subj,e.target.checked)} />
              <span style={{fontSize:12,fontWeight:700,color:C.gray}}>{subj}</span>
            </div>;
          })}
        </div>
      </div>;
    })}
  </div>;
}

// ─── EXCEL HELPERS (Settings) ───────────────────────────────────────────────
function downloadExcel(wb, filename){ const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" }); const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
function excelDateToDDMMYYYY(v){
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") {
    const base = new Date(Date.UTC(1899, 11, 30)); // Excel serial date base
    base.setUTCDate(base.getUTCDate() + Math.floor(v));
    const d = String(base.getUTCDate()).padStart(2,"0");
    const m = String(base.getUTCMonth()+1).padStart(2,"0");
    const y = base.getUTCFullYear();
    return `${d}/${m}/${y}`;
  }
  const s = String(v).trim();
  return s;
}
function parseWorkbook(file, cb){
  const r = new FileReader();
  r.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const getSheet = (name) => {
        const sh = wb.Sheets[name];
        return sh ? XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" }) : null;
      };
      cb(null, {
        General: getSheet("General"),
        Classes: getSheet("Classes"),
        Staff: getSheet("Staff"),
        Students: getSheet("Students"),
      });
    } catch (err) {
      cb(err, null);
    }
  };
  r.readAsArrayBuffer(file);
}

function SettingsPage({settings,setSettings,resetAll,students,setStudents,schools,activeSchoolId,setActiveSchoolId,addSchool,removeSchool}){
  const [tab,setTab]=useState("general");
  const [newCls,setNewCls]=useState({grade:"",section:""});
  const [newStaff,setNewStaff]=useState({name:"",designation:"",subjects:""});
  const [editingStaffId,setEditingStaffId]=useState(null);
  const fileRef=useRef();
  const settingsExcelRef=useRef();
  const tabs=[{id:"general",label:"General"},{id:"school",label:"School"},{id:"classes",label:"Classes & Subjects"},{id:"staff",label:"Staff"},{id:"common",label:"Common Teachers"},{id:"time",label:"Time & Periods"}];

  const downloadTemplate=()=>{
    const wb = XLSX.utils.book_new();
    const wsGeneral = XLSX.utils.aoa_to_sheet([["School Name","Principal Name","School Code"], [settings.schoolName||"", settings.principalName||"", settings.schoolCode||""]]);
    const wsClasses = XLSX.utils.aoa_to_sheet([["Class ID","Class Name","Grade","Section","Subjects"], ["10-BS","10TH-BS","10","BS","English, Physics, Urdu"], ["9-CS","9TH-CS","9","CS","English, Computer, Urdu"]]);
    const wsStaff = XLSX.utils.aoa_to_sheet([["Name","Designation","Subjects"], ["Kazmi","SST","English, Physics"], ["Imtiaz","SST","Urdu, Islamiat"]]);
    const wsStudents = XLSX.utils.aoa_to_sheet([["Admission No","Roll No","Student Name","Father Name","Grade","Section","DOB","Bay Form","Father CNIC","WhatsApp No"]]);
    XLSX.utils.book_append_sheet(wb, wsGeneral, "General");
    XLSX.utils.book_append_sheet(wb, wsClasses, "Classes");
    XLSX.utils.book_append_sheet(wb, wsStaff, "Staff");
    XLSX.utils.book_append_sheet(wb, wsStudents, "Students");
    downloadExcel(wb, "settings_template.xlsx");
  };
  const importFromExcel=(e)=>{
    const f = e.target.files[0]; if (!f) return;
    parseWorkbook(f, (err, sheets)=>{
      if (err) { alert("Failed to read file: " + err.message); e.target.value = ""; return; }
      let msg = [];
      let importedClasses = [];
      if (sheets.General && sheets.General.length >= 2) { const r = sheets.General[1] || []; setSettings(s => ({ ...s, schoolName: String(r[0] || s.schoolName || ""), principalName: String(r[1] || s.principalName || ""), schoolCode: String(r[2] || s.schoolCode || "") })); msg.push("General"); }
      if (sheets.Classes && sheets.Classes.length >= 2) {
        const [header, ...dataRows] = sheets.Classes;
        const classSubjects = {};
        const conflicts = [];
        const byId = {};
        dataRows.forEach(row => {
          const id = String(row[0] || "").trim();
          const name = String(row[1] || "").trim();
          const grade = String(row[2] || "").trim();
          const section = String(row[3] || "").trim();
          const subjsStr = String(row[4] || "").trim();
          if (!id && !name && !grade) return;
          const cid = id || (grade ? `${grade}-${section || name}` : name) || genId();
          // Make class name consistent with manual Add Class (e.g. 10TH-BS)
          let autoName=name;
          if(!autoName){
            if(grade){
              if(section) autoName=`${grade}TH-${section.toUpperCase()}`;
              else autoName=`Class ${grade}`;
            }else{
              autoName=cid;
            }
          }
          const norm = { name: autoName, grade: grade || "", section: section || "" };
          const prev = byId[cid];
          if (prev && (prev.name !== norm.name || prev.grade !== norm.grade || prev.section !== norm.section)) {
            conflicts.push(cid);
            return;
          }
          // First occurrence defines the class; later identical ones just merge subjects
          if (!prev) {
            byId[cid] = norm;
          }
          const subjs = subjsStr ? subjsStr.split(",").map(s => s.trim()).filter(Boolean) : [];
          if (!classSubjects[cid]) classSubjects[cid] = [];
          subjs.forEach(s => {
            if (!classSubjects[cid].includes(s)) classSubjects[cid].push(s);
          });
        });
        const classes = Object.entries(byId).map(([id, norm]) => ({ id, ...norm }));
        if (classes.length) {
          importedClasses = classes;
          setSettings(s => ({
            ...s,
            classes: [
              // keep existing classes whose IDs are not in imported set
              ...s.classes.filter(c => !classes.find(n => n.id === c.id)),
              // add imported classes (one per ID)
              ...classes,
            ],
            // merge/replace subjects per class ID
            classSubjects: { ...s.classSubjects, ...classSubjects },
          }));
          msg.push(classes.length + " class(es)");
        }
        if (conflicts.length) {
          msg.push("Class conflicts for IDs: " + Array.from(new Set(conflicts)).join(", "));
        }
      }
      if (sheets.Staff && sheets.Staff.length >= 2) {
        const [header, ...dataRows] = sheets.Staff;
        const staff = dataRows.map((row, i) => {
          const name = String(row[0] || "").trim();
          const designation = String(row[1] || "").trim();
          const subjsStr = String(row[2] || "").trim();
          const subjects = subjsStr ? subjsStr.split(",").map(s => s.trim()).filter(Boolean) : [];
          return { id: genId(), name: name || "Staff " + (i + 1), designation: designation || "", subjects };
        }).filter(s => s.name);
        if (staff.length) { setSettings(s => ({ ...s, staff: [...s.staff, ...staff] })); msg.push(staff.length + " staff"); }
      }
      if (sheets.Students && sheets.Students.length >= 2) {
        const [header, ...dataRows] = sheets.Students;
        const imported = dataRows.map((row) => {
          const admissionNo = String(row[0] || "").trim();
          const rollNo = String(row[1] || "").trim();
          const name = String(row[2] || "").trim();
          const fatherName = String(row[3] || "").trim();
          const grade = String(row[4] || "").trim();
          const section = String(row[5] || "").trim();
          const dob = excelDateToDDMMYYYY(row[6]);
          const bayForm = String(row[7] || "").trim();
          const fatherCnic = String(row[8] || "").trim();
          let whatsapp = String(row[9] || "").trim();
          // Normalize WhatsApp to preserve leading zero when Excel drops it
          const wDigits = whatsapp.replace(/\D/g,"");
          if (wDigits.length === 10) {
            whatsapp = "0" + wDigits;
          } else if (wDigits.length === 11) {
            whatsapp = wDigits;
          }
          if (!admissionNo && !rollNo && !name) return null;
          let classId = "";
          if (grade) {
            const gNorm = grade.toLowerCase();
            const sNorm = section.toLowerCase();
            let cls = importedClasses.find(c =>
              String(c.grade || "").trim().toLowerCase() === gNorm &&
              String(c.section || "").trim().toLowerCase() === sNorm
            );
            if (!cls) {
              cls = settings.classes.find(c =>
                String(c.grade || "").trim().toLowerCase() === gNorm &&
                String(c.section || "").trim().toLowerCase() === sNorm
              );
            }
            if (cls) {
              classId = cls.id;
            } else {
              classId = `${grade}-${section || ""}`;
            }
          }
          return {
            id: genId(),
            admissionNo,
            rollNo,
            name,
            fatherName,
            classId,
            dob,
            bayForm,
            fatherCnic,
            whatsapp,
            photo: null,
          };
        }).filter(Boolean);
        if (imported.length) {
          setStudents(prev => [...prev, ...imported]);
          msg.push(imported.length + " student(s)");
        }
      }
      e.target.value = ""; alert(msg.length ? "Imported: " + msg.join(", ") : "No data found in General, Classes, Staff, or Students sheets.");
    });
  };
  const exportData=()=>{
    const wb = XLSX.utils.book_new();
    const wsGeneral = XLSX.utils.aoa_to_sheet([["School Name","Principal Name","School Code"], [settings.schoolName || "", settings.principalName || "", settings.schoolCode || ""]]);
    const wsClasses = XLSX.utils.aoa_to_sheet([["Class ID","Class Name","Grade","Section","Subjects"], ...settings.classes.map(c => [c.id, c.name, c.grade, c.section, (settings.classSubjects[c.id] || []).join(", ")])]);
    const wsStaff = XLSX.utils.aoa_to_sheet([["Name","Designation","Subjects"], ...settings.staff.map(st => [st.name, st.designation, (st.subjects || []).join(", ")])]);
    const wsStudents = XLSX.utils.aoa_to_sheet([
      ["Admission No","Roll No","Student Name","Father Name","Grade","Section","DOB","Bay Form","Father CNIC","WhatsApp No"],
      ...students.map(s => {
        const cls = settings.classes.find(c => c.id === s.classId) || {};
        return [
          s.admissionNo || "",
          s.rollNo || "",
          s.name || "",
          s.fatherName || "",
          cls.grade || "",
          cls.section || "",
          s.dob || "",
          s.bayForm || "",
          s.fatherCnic || "",
          s.whatsapp || "",
        ];
      }),
    ]);
    XLSX.utils.book_append_sheet(wb, wsGeneral, "General");
    XLSX.utils.book_append_sheet(wb, wsClasses, "Classes");
    XLSX.utils.book_append_sheet(wb, wsStaff, "Staff");
    XLSX.utils.book_append_sheet(wb, wsStudents, "Students");
    // Additional sheets: one per grade (all sections of that grade together)
    const byGrade = {};
    students.forEach(s => {
      const cls = settings.classes.find(c => c.id === s.classId);
      const grade = cls?.grade;
      if (!grade) return;
      if (!byGrade[grade]) byGrade[grade] = [];
      byGrade[grade].push({
        admissionNo: s.admissionNo || "",
        rollNo: s.rollNo || "",
        name: s.name || "",
        fatherName: s.fatherName || "",
        grade: cls.grade || "",
        section: cls.section || "",
        dob: s.dob || "",
        bayForm: s.bayForm || "",
        fatherCnic: s.fatherCnic || "",
        whatsapp: s.whatsapp || "",
      });
    });
    Object.entries(byGrade).forEach(([grade, rows]) => {
      if (!rows.length) return;
      const sheetName = (`Class ${grade}`).slice(0,31);
      const wsClass = XLSX.utils.aoa_to_sheet([
        ["Admission No","Roll No","Student Name","Father Name","Grade","Section","DOB","Bay Form","Father CNIC","WhatsApp No"],
        ...rows.map(r => [
          r.admissionNo,
          r.rollNo,
          r.name,
          r.fatherName,
          r.grade,
          r.section,
          r.dob,
          r.bayForm,
          r.fatherCnic,
          r.whatsapp,
        ]),
      ]);
      XLSX.utils.book_append_sheet(wb, wsClass, sheetName);
    });
    downloadExcel(wb, "settings_export.xlsx");
  };

  const addClass=()=>{
    if(!newCls.grade) return;
    const name=newCls.section?`${newCls.grade}TH-${newCls.section.toUpperCase()}`:`Class ${newCls.grade}`;
    const id=`${newCls.grade}-${newCls.section||name}`;
    if(settings.classes.find(c=>c.id===id)) return alert("Class already exists");
    setSettings(s=>({...s,classes:[...s.classes,{id,name,grade:newCls.grade,section:newCls.section}],classSubjects:{...s.classSubjects,[id]:[]}}));
    setNewCls({grade:"",section:""});
  };
  const removeClass=(id)=>setSettings(s=>({...s,classes:s.classes.filter(c=>c.id!==id),classSubjects:Object.fromEntries(Object.entries(s.classSubjects).filter(([k])=>k!==id))}));
  const addSubj=(id,subj)=>{ if(!subj) return; setSettings(s=>({...s,classSubjects:{...s.classSubjects,[id]:[...(s.classSubjects[id]||[]),subj]}})); };
  const rmSubj=(id,subj)=>setSettings(s=>({...s,classSubjects:{...s.classSubjects,[id]:s.classSubjects[id].filter(x=>x!==subj)}}));
  const addStaff=()=>{
    if(!newStaff.name) return;
    if(editingStaffId){
      setSettings(s=>({...s,staff:s.staff.map(st=>st.id===editingStaffId?{...st,name:newStaff.name,designation:newStaff.designation,subjects:newStaff.subjects.split(",").map(x=>x.trim()).filter(Boolean)}:st)}));
      setEditingStaffId(null);
    } else {
      setSettings(s=>({...s,staff:[...s.staff,{id:genId(),name:newStaff.name,designation:newStaff.designation,subjects:newStaff.subjects.split(",").map(x=>x.trim()).filter(Boolean)}]}));
    }
    setNewStaff({name:"",designation:"",subjects:""});
  };
  const openEditStaff=(st)=>{ setEditingStaffId(st.id); setNewStaff({name:st.name,designation:st.designation||"",subjects:(st.subjects||[]).join(", ")}); };
  const cancelEditStaff=()=>{ setEditingStaffId(null); setNewStaff({name:"",designation:"",subjects:""}); };
  const rmStaff=(id)=>{ setSettings(s=>({...s,staff:s.staff.filter(st=>st.id!==id)})); if(editingStaffId===id) cancelEditStaff(); };

  const activeSchool = schools.find(s=>s.id===activeSchoolId) || schools[0] || {name:""};

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
      <h2 style={{margin:0,color:C.navy,fontFamily:"Georgia,serif",fontSize:20}}>⚙️ {tabs.find(t=>t.id===tab)?.label||"Settings"}</h2>
      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}>
        <label style={{fontWeight:700,color:C.gray}}>School:</label>
        <select
          value={activeSchoolId || ""}
          onChange={e=>setActiveSchoolId(e.target.value)}
          style={{padding:"4px 6px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:12,background:"#fff"}}
        >
          {schools.map(s=><option key={s.id} value={s.id}>{s.name||"Untitled School"}</option>)}
        </select>
        <Btn small outline onClick={addSchool}>+ Add</Btn>
        <Btn small danger disabled={schools.length<=1} onClick={()=>removeSchool(activeSchoolId)}>Remove</Btn>
      </div>
    </div>
    <div style={{display:"flex",gap:6,marginBottom:18,flexWrap:"wrap"}}>
      {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"7px 16px",borderRadius:5,border:"none",background:tab===t.id?C.navy:"#e5e7eb",color:tab===t.id?"#fff":"#374151",fontWeight:600,cursor:"pointer",fontSize:13}}>{t.label}</button>)}
    </div>

    {tab==="general"&&<div style={{maxWidth:480}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:18,maxWidth:600}}>
        <Btn outline onClick={downloadTemplate} style={{width:"100%"}}>📥 Download Template</Btn>
        <Btn outline onClick={()=>settingsExcelRef.current.click()} style={{width:"100%"}}>📂 Import from Excel</Btn>
        <input ref={settingsExcelRef} type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={importFromExcel}/>
        <Btn outline onClick={exportData} style={{width:"100%"}}>📤 Export Data</Btn>
      </div>
      <div style={{marginTop:16,padding:12,borderRadius:8,background:"#fff7f7",border:"1px solid #fecaca"}}>
        <h4 style={{margin:"0 0 8px",fontSize:13,color:C.red}}>Danger zone</h4>
        <p style={{margin:"0 0 10px",fontSize:12,color:C.gray}}>This will remove all classes, subjects, staff, and custom settings and reload the app with default demo data.</p>
        <Btn
          danger
          onClick={()=>{
            if(!window.confirm("Are you sure you want to remove all school data and restart? This cannot be undone.")) return;
            resetAll();
          }}
        >
          🗑️ Remove All School Data & Refresh
        </Btn>
      </div>
    </div>}

    {tab==="school"&&<div style={{maxWidth:480}}>
      <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
        {settings.logo?<img src={settings.logo} style={{width:60,height:60,borderRadius:"50%",objectFit:"cover"}}/>
          :<div style={{width:60,height:60,borderRadius:"50%",background:C.navy,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:22}}>★</div>}
        <div><Btn small onClick={()=>fileRef.current.click()}>Upload Logo</Btn>
          {settings.logo&&<Btn small danger style={{marginLeft:8}} onClick={()=>setSettings(s=>({...s,logo:null}))}>Remove</Btn>}
          <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setSettings(s=>({...s,logo:ev.target.result}));r.readAsDataURL(f);}}/></div>
      </div>
      {[["schoolName","School Name"],["principalName","Principal / Headmaster Name"],["schoolCode","School Code"],["institutionAddress","School Address"]].map(([key,label])=>(
        <div key={key} style={{marginBottom:12}}>
          <label style={{fontSize:11,fontWeight:700,color:C.gray,display:"block",marginBottom:3}}>{label}</label>
          <input value={settings[key]||""} onChange={e=>setSettings(s=>({...s,[key]:e.target.value}))} style={{width:"100%",padding:"7px 10px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:14,boxSizing:"border-box"}} placeholder={key==="institutionAddress"?"Full address":""}/>
        </div>
      ))}
      <div style={{padding:10,background:"#d1fae5",borderRadius:6,fontSize:12,color:"#065f46"}}>✅ Changes saved automatically</div>
    </div>}

    {tab==="classes"&&<div>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"flex-end"}}>
        <Inp label="Grade" value={newCls.grade} onChange={v=>setNewCls(x=>({...x,grade:v}))} width={80}/>
        <Inp label="Section" value={newCls.section} onChange={v=>setNewCls(x=>({...x,section:v}))} width={80}/>
        <Btn onClick={addClass}>+ Add Class</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
        {settings.classes.map(cls=><ClassSubjCard key={cls.id} cls={cls} subjects={settings.classSubjects[cls.id]||[]}
          onAdd={s=>addSubj(cls.id,s)} onRemove={s=>rmSubj(cls.id,s)} onRemoveClass={()=>removeClass(cls.id)}/>)}
      </div>
    </div>}

    {tab==="staff"&&<div>
      <div style={{background:"#f9fafb",borderRadius:8,padding:14,marginBottom:14,display:"grid",gridTemplateColumns:"1fr 1fr 2fr auto auto",gap:8,alignItems:"flex-end"}}>
        <Inp label="Name" value={newStaff.name} onChange={v=>setNewStaff(s=>({...s,name:v}))}/>
        <Inp label="Designation" value={newStaff.designation} onChange={v=>setNewStaff(s=>({...s,designation:v}))}/>
        <Inp label="Subjects (comma separated)" value={newStaff.subjects} onChange={v=>setNewStaff(s=>({...s,subjects:v}))}/>
        <Btn onClick={addStaff}>{editingStaffId?"Update":"Add"}</Btn>
        {editingStaffId&&<Btn small onClick={cancelEditStaff}>Cancel</Btn>}
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",fontSize:13,width:"100%"}}>
          <thead><tr style={{background:C.navy,color:"#fff"}}>{["#","Name","Designation","Subjects","Action"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left"}}>{h}</th>)}</tr></thead>
          <tbody>{settings.staff.map((st,i)=><tr key={st.id} style={{background:i%2===0?"#f9fafb":"#fff"}}>
            <td style={{padding:"6px 10px"}}>{i+1}</td><td style={{padding:"6px 10px",fontWeight:600}}>{st.name}</td>
            <td style={{padding:"6px 10px"}}>{st.designation}</td><td style={{padding:"6px 10px"}}>{st.subjects.join(", ")}</td>
            <td style={{padding:"6px 10px"}}><Btn small onClick={()=>openEditStaff(st)} style={{marginRight:6}}>Edit</Btn><Btn small danger onClick={()=>rmStaff(st.id)}>Remove</Btn></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>}

    {tab==="common"&&<CommonTeachersEditor settings={settings} setSettings={setSettings}/>}

    {tab==="time"&&<div style={{maxWidth:620}}>
      <div style={{background:"#f9fafb",borderRadius:8,padding:14,marginBottom:14}}>
        <h4 style={{margin:"0 0 10px",color:C.navy}}>School Hours</h4>
        {[{key:"mondayToThursday",label:"Monday – Thursday"},{key:"friday",label:"Friday"},{key:"saturday",label:"Saturday"}].map(({key,label})=>(
          <div key={key} style={{display:"grid",gridTemplateColumns:"160px 1fr 1fr",gap:8,marginBottom:8,alignItems:"flex-end"}}>
            <span style={{fontSize:13,fontWeight:600}}>{label}</span>
            <Inp label="Start" type="time" value={settings.schoolHours[key].start} onChange={v=>setSettings(s=>({...s,schoolHours:{...s.schoolHours,[key]:{...s.schoolHours[key],start:v}}}))}/>
            <Inp label="End" type="time" value={settings.schoolHours[key].end} onChange={v=>setSettings(s=>({...s,schoolHours:{...s.schoolHours,[key]:{...s.schoolHours[key],end:v}}}))}/>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        {[["assemblyTime","Assembly Time (min)"],["firstPeriodTime","1st Period (min)"],["otherPeriodTime","Other Periods (min)"],["periodsPerDay","Periods Per Day"]].map(([key,label])=>(
          <div key={key}>
            <label style={{fontSize:11,fontWeight:700,color:C.gray,display:"block",marginBottom:3}}>{label}</label>
            <input type="number" value={settings[key]} onChange={e=>setSettings(s=>({...s,[key]:+e.target.value}))} style={{width:"100%",padding:"7px 10px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:14,boxSizing:"border-box"}}/>
          </div>
        ))}
      </div>
      <div style={{background:"#f9fafb",borderRadius:8,padding:14}}>
        <h4 style={{margin:"0 0 10px",color:C.navy}}>Break Settings</h4>
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:14,fontWeight:600,marginBottom:10,cursor:"pointer"}}>
          <input type="checkbox" checked={settings.breakRequired} onChange={e=>setSettings(s=>({...s,breakRequired:e.target.checked}))}/>
          Break Required (Mon–Thu / Sat)
        </label>
        {settings.breakRequired&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          <div><label style={{fontSize:11,fontWeight:700,color:C.gray,display:"block",marginBottom:3}}>Break After Period #</label><input type="number" value={settings.breakAfterPeriod} onChange={e=>setSettings(s=>({...s,breakAfterPeriod:+e.target.value}))} style={{width:"100%",padding:"7px 10px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:14,boxSizing:"border-box"}}/></div>
          <div><label style={{fontSize:11,fontWeight:700,color:C.gray,display:"block",marginBottom:3}}>Break Duration (min)</label><input type="number" value={settings.breakDuration} onChange={e=>setSettings(s=>({...s,breakDuration:+e.target.value}))} style={{width:"100%",padding:"7px 10px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:14,boxSizing:"border-box"}}/></div>
        </div>}
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:14,fontWeight:600,marginBottom:8,cursor:"pointer"}}>
          <input type="checkbox" checked={settings.fridayBreak} onChange={e=>setSettings(s=>({...s,fridayBreak:e.target.checked}))}/>
          Friday Break Required
        </label>
        {settings.fridayBreak&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div><label style={{fontSize:11,fontWeight:700,color:C.gray,display:"block",marginBottom:3}}>Friday Break After Period #</label><input type="number" value={settings.fridayBreakAfter} onChange={e=>setSettings(s=>({...s,fridayBreakAfter:+e.target.value}))} style={{width:"100%",padding:"7px 10px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:14,boxSizing:"border-box"}}/></div>
          <div><label style={{fontSize:11,fontWeight:700,color:C.gray,display:"block",marginBottom:3}}>Friday Break Duration (min)</label><input type="number" value={settings.fridayBreakDuration} onChange={e=>setSettings(s=>({...s,fridayBreakDuration:+e.target.value}))} style={{width:"100%",padding:"7px 10px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:14,boxSizing:"border-box"}}/></div>
        </div>}
      </div>
    </div>}
  </div>;
}

// ─── ATTENDANCE ────────────────────────────────────────────────────────────────
function AttendancePage({settings,students}){
  const [selCls,setSelCls]=useState(settings.classes[0]?.id||"");
  const [date,setDate]=useState(new Date().toISOString().split("T")[0]);
  const [att,setAtt]=useState({});
  const [applications,setApplications]=useState({});
  const [viewApp,setViewApp]=useState(null);
  const key=`${selCls}_${date}`;
  const classAtt=att[key]||{};
  const classApps=applications[key]||{};
  const cs=students.filter(s=>s.classId===selCls);
  const toggle=(id,status)=>setAtt(a=>({...a,[key]:{...classAtt,[id]:status}}));
  const markAll=(status)=>{ const v={}; cs.forEach(s=>{v[s.id]=status;}); setAtt(a=>({...a,[key]:v})); };
  const present=cs.filter(s=>classAtt[s.id]==="P").length;
  const absent=cs.filter(s=>classAtt[s.id]==="A").length;
  const handleUpload=(sid,e)=>{
    const f=e?.target?.files?.[0]; if(!f)return;
    if(!f.type.match(/^image\//)&&f.type!=="application/pdf"&&f.type!=="application/msword"&&f.type!=="application/vnd.openxmlformats-officedocument.wordprocessingml.document")return;
    const r=new FileReader(); r.onload=ev=>{ setApplications(a=>({...a,[key]:{...classApps,[sid]:{data:ev.target.result,mime:f.type,name:f.name}}})); }; r.readAsDataURL(f);
  };
  const openUpload=(sid)=>{ const el=document.createElement("input"); el.type="file"; el.accept="image/*,.pdf,.doc,.docx"; el.onchange=e=>handleUpload(sid,e); el.click(); };
  const isImage=(m)=>m&&m.startsWith("image/");
  const isPdf=(m)=>m==="application/pdf";
  return <div>
    <h2 style={{margin:"0 0 16px",color:C.navy,fontFamily:"Georgia,serif",fontSize:20}}>📋 Attendance</h2>
    <div style={{display:"flex",gap:12,marginBottom:14,flexWrap:"wrap",alignItems:"flex-end"}}>
      <Sel label="Class" value={selCls} onChange={setSelCls} options={settings.classes.map(c=>({value:c.id,label:c.name}))}/>
      <Inp label="Date" type="date" value={date} onChange={setDate}/>
      <div style={{display:"flex",gap:8,paddingTop:16}}><Btn small color={C.green} onClick={()=>markAll("P")}>✔ All Present</Btn><Btn small color={C.red} onClick={()=>markAll("A")}>✘ All Absent</Btn></div>
    </div>
    <div style={{display:"flex",gap:12,marginBottom:14}}>
      {[{l:"Total",v:cs.length,c:C.navy},{l:"Present",v:present,c:C.green},{l:"Absent",v:absent,c:C.red},{l:"Unmarked",v:cs.length-present-absent,c:C.gold}].map(({l,v,c})=>(
        <div key={l} style={{background:"#fff",border:`2px solid ${c}`,borderRadius:8,padding:"8px 16px",textAlign:"center"}}>
          <div style={{fontSize:26,fontWeight:700,color:c}}>{v}</div>
          <div style={{fontSize:11,color:C.gray}}>{l}</div>
        </div>
      ))}
    </div>
    {cs.length===0?<div style={{padding:20,color:C.gray,textAlign:"center"}}>No students in this class.</div>:(
      <table style={{borderCollapse:"collapse",fontSize:13,width:"100%"}}>
        <thead><tr style={{background:C.navy,color:"#fff"}}>{["Roll No","Name","Father's Name","Status","Mark","Application"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left"}}>{h}</th>)}</tr></thead>
        <tbody>{cs.map((s,i)=><tr key={s.id} style={{background:i%2===0?"#f9fafb":"#fff"}}>
          <td style={{padding:"6px 10px",fontWeight:700}}>{s.rollNo}</td><td style={{padding:"6px 10px"}}>{s.name}</td><td style={{padding:"6px 10px"}}>{s.fatherName}</td>
          <td style={{padding:"6px 10px",fontWeight:700,color:classAtt[s.id]==="P"?C.green:classAtt[s.id]==="A"?C.red:C.gold}}>{classAtt[s.id]||"—"}</td>
          <td style={{padding:"6px 10px"}}><div style={{display:"flex",gap:4}}><Btn small color={C.green} onClick={()=>toggle(s.id,"P")}>P</Btn><Btn small color={C.red} onClick={()=>toggle(s.id,"A")}>A</Btn><Btn small color={C.gold} onClick={()=>toggle(s.id,"L")}>L</Btn></div></td>
          <td style={{padding:"6px 10px"}}>
            {classApps[s.id]?<Btn small outline onClick={()=>setViewApp(classApps[s.id])}>View</Btn>:<Btn small outline onClick={()=>openUpload(s.id)}>Upload Application</Btn>}
          </td>
        </tr>)}</tbody>
      </table>
    )}
    {viewApp&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setViewApp(null)}>
      <div style={{background:"#fff",borderRadius:10,maxWidth:"90vw",maxHeight:"90vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",borderBottom:"1px solid #e5e7eb"}}>
          <span style={{fontWeight:700,fontSize:14}}>{viewApp.name||"Application"}</span>
          <button onClick={()=>setViewApp(null)} style={{background:"none",border:"none",fontSize:22,cursor:"pointer",color:C.gray}}>×</button>
        </div>
        <div style={{padding:16,minHeight:200}}>
          {isImage(viewApp.mime)&&<img src={viewApp.data} alt="Application" style={{maxWidth:"100%",height:"auto",display:"block"}}/>}
          {isPdf(viewApp.mime)&&<embed src={viewApp.data} type="application/pdf" style={{width:"100%",minHeight:"70vh"}}/>}
          {viewApp.mime&&!isImage(viewApp.mime)&&!isPdf(viewApp.mime)&&<div style={{textAlign:"center",padding:24}}><p style={{marginBottom:12}}>Word/document file — open in new tab to view.</p><a href={viewApp.data} download={viewApp.name||"application.doc"} target="_blank" rel="noopener noreferrer" style={{color:C.navy,fontWeight:600}}>Open / Download</a></div>}
        </div>
      </div>
    </div>}
  </div>;
}

// ─── EXAMINATION ───────────────────────────────────────────────────────────────
const EXAM_TABS=[{id:"record",l:"Student Record"},{id:"marks",l:"Enter Marks"},{id:"consolidated",l:"Consolidated Sheet"},{id:"card",l:"Result Card"},{id:"datesheet",l:"Date Sheet"}];
function ExaminationPage({settings,setSettings,students,setStudents,timetable}){
  const [tab,setTab]=useState("record");
  const [selCls,setSelCls]=useState(settings.classes[0]?.id||"");
  const [exam,setExam]=useState("1st Term");
  const [TM,setTM]=useState({});
  const [OM,setOM]=useState({});
  const [rcCls,setRcCls]=useState(settings.classes[0]?.id||""); const [rcRoll,setRcRoll]=useState("");
  const [dsDates,setDsDates]=useState([{id:genId(),date:new Date().toISOString().split("T")[0]}]);
  const [dsCols,setDsCols]=useState([{id:genId(),classId:settings.classes[0]?.id||""}]);
  const [dsSubs,setDsSubs]=useState({}); // key: `${dateId}_${colId}` -> subject
  const [dsNote,setDsNote]=useState("");
  const exams=["1st Term","Mid Term","Final Term","Annual"];
  const subjs=(cls)=>settings.classSubjects[cls]||[];
  const cs=(cls)=>students.filter(s=>s.classId===cls);
  const [printCardsMode,setPrintCardsMode]=useState(null);
  const [rcExam,setRcExam]=useState("overall");
  // Persist exam marks locally per school
  useEffect(()=>{
    try{
      const suffix=(settings.schoolCode||settings.schoolName||"default").replace(/[^a-zA-Z0-9_-]/g,"_");
      const tmKey=`exam_TM_${suffix}`;
      const omKey=`exam_OM_${suffix}`;
      const rawTM=typeof window!=="undefined"?window.localStorage.getItem(tmKey):null;
      const rawOM=typeof window!=="undefined"?window.localStorage.getItem(omKey):null;
      if(rawTM){ const parsed=JSON.parse(rawTM); if(parsed&&typeof parsed==="object") setTM(parsed); }
      if(rawOM){ const parsed=JSON.parse(rawOM); if(parsed&&typeof parsed==="object") setOM(parsed); }
    }catch(e){}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[settings.schoolCode,settings.schoolName]);
  useEffect(()=>{
    try{
      const suffix=(settings.schoolCode||settings.schoolName||"default").replace(/[^a-zA-Z0-9_-]/g,"_");
      const tmKey=`exam_TM_${suffix}`;
      if(typeof window!=="undefined") window.localStorage.setItem(tmKey,JSON.stringify(TM));
    }catch(e){}
  },[TM,settings.schoolCode,settings.schoolName]);
  useEffect(()=>{
    try{
      const suffix=(settings.schoolCode||settings.schoolName||"default").replace(/[^a-zA-Z0-9_-]/g,"_");
      const omKey=`exam_OM_${suffix}`;
      if(typeof window!=="undefined") window.localStorage.setItem(omKey,JSON.stringify(OM));
    }catch(e){}
  },[OM,settings.schoolCode,settings.schoolName]);
  const gtm=(e,c,s)=>TM[`${e}_${c}_${s}`]||"";
  const stm=(e,c,s,v)=>setTM(t=>({...t,[`${e}_${c}_${s}`]:v}));
  const gom=(e,c,id,s)=>OM[`${e}_${c}_${id}_${s}`]||"";
  const som=(e,c,id,s,v)=>{ const tm=parseFloat(gtm(e,c,s)),n=parseFloat(v); if(v!==""&&(n<0||(!isNaN(tm)&&n>tm))) return; setOM(m=>({...m,[`${e}_${c}_${id}_${s}`]:v})); };
  const calc=(e,c,id)=>{ let tot=0,obt=0; subjs(c).forEach(s=>{const t=parseFloat(gtm(e,c,s)),o=parseFloat(gom(e,c,id,s)); if(!isNaN(t))tot+=t; if(!isNaN(o))obt+=o;}); return {tot,obt,pct:tot>0?((obt/tot)*100).toFixed(1):"—"}; };
  const passThreshold=Number(settings.passPercent)||50;
  const grade=(p)=>{ const n=parseFloat(p); if(isNaN(n))return "—"; if(n>=80)return "A+"; if(n>=70)return "A"; if(n>=60)return "B"; if(n>=50)return "C"; if(n>=40)return "D"; return "F"; };
  const getClassTeacher=(classId)=>{
    if(!classId) return "";
    const cell=getTT(timetable||{},classId,"Monday",0);
    return cell.teacher||"";
  };
  const subjectStat=(mode,classId,studentId,subj)=>{
    let tot=0,obt=0;
    if(mode==="overall"){
      exams.forEach(e=>{
        const t=parseFloat(gtm(e,classId,subj));
        const o=parseFloat(gom(e,classId,studentId,subj));
        if(!isNaN(t)) tot+=t;
        if(!isNaN(o)) obt+=o;
      });
    }else{
      const t=parseFloat(gtm(mode,classId,subj));
      const o=parseFloat(gom(mode,classId,studentId,subj));
      if(!isNaN(t)) tot=t;
      if(!isNaN(o)) obt=o;
    }
    let pctStr="—",gradeStr="—",status="—";
    if(tot>0){
      const pct=(obt/tot)*100;
      pctStr=pct.toFixed(1);
      gradeStr=grade(pctStr);
      status=pct>=passThreshold?"PASS":"FAIL";
    }
    return {obt,tot,pctStr,gradeStr,status};
  };
  const overallStat=(mode,classId,studentId)=>{
    let tot=0,obt=0;
    subjs(classId).forEach(subj=>{
      const s=subjectStat(mode,classId,studentId,subj);
      tot+=s.tot;
      obt+=s.obt;
    });
    let pctStr="—",gradeStr="—",status="—";
    if(tot>0){
      const pct=(obt/tot)*100;
      pctStr=pct.toFixed(1);
      gradeStr=grade(pctStr);
      status=pct>=passThreshold?"PASS":"FAIL";
    }
    return {obt,tot,pctStr,gradeStr,status};
  };
  const renderResultCard=(st,classId,mode)=>{
    const cls=settings.classes.find(c=>c.id===classId);
    const className=cls?.name;
    const classTeacher=getClassTeacher(classId);
    return <div key={st.id} style={{maxWidth:700,margin:"0 auto 24px",pageBreakAfter:"always",page:"resultCard"}}>
      <div style={{position:"relative",padding:36,background:"#fff",borderRadius:8,backgroundImage:`url(${RESULT_CARD_BORDER_URL})`,backgroundRepeat:"no-repeat",backgroundPosition:"center",backgroundSize:"contain",minHeight:800}}>
      <SchoolHeader
        settings={settings}
        subtitle="STUDENT RESULT CARD"
        rightText={`${mode==="overall"?"Overall Result":mode} | Session ${academicSession()}`}
      />
      <div style={{display:"flex",gap:18,marginBottom:14,alignItems:"flex-start"}}>
        <div style={{flex:1}}>{[["Name",st.name],["Father",st.fatherName],["Class",className],["Roll No",st.rollNo],["Adm No",st.admissionNo],["DOB",st.dob]].map(([k,v])=>(
          <div key={k} style={{display:"flex",gap:8,marginBottom:4,fontSize:13}}><span style={{fontWeight:700,minWidth:90,color:"#374151"}}>{k}:</span><span>{v}</span></div>
        ))}</div>
        <div style={{width:80,height:100,border:"2px solid #d1d5db",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",background:"#f3f4f6"}}>
          {st.photo?<img src={st.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:10,color:C.gray,textAlign:"center"}}>Photo</span>}
        </div>
      </div>
      <div style={{overflowX:"auto"}}><table style={{borderCollapse:"collapse",fontSize:12,width:"100%",background:"#fff"}}>
        <thead>
          <tr style={{background:C.navy,color:"#fff"}}>
            <th style={{padding:"5px 8px"}}>Subject</th>
            <th style={{padding:"5px 8px",textAlign:"center"}}>Marks</th>
            <th style={{padding:"5px 8px",textAlign:"center"}}>Pass %</th>
            <th style={{padding:"5px 8px",textAlign:"center"}}>Grade</th>
            <th style={{padding:"5px 8px",textAlign:"center"}}>Result</th>
          </tr>
        </thead>
        <tbody>
          {subjs(classId).map((subj,i)=>{
            const s=subjectStat(mode,classId,st.id,subj);
            return <tr key={subj} style={{background:i%2===0?"#f9fafb":"#fff"}}>
              <td style={{padding:"5px 8px",fontWeight:600}}>{subj}</td>
              <td style={{padding:"5px 8px",textAlign:"center"}}>{s.tot>0?`${s.obt}/${s.tot}`:"—"}</td>
              <td style={{padding:"5px 8px",textAlign:"center"}}>{s.pctStr==="—"?"—":`${s.pctStr}%`}</td>
              <td style={{padding:"5px 8px",textAlign:"center"}}>{s.gradeStr}</td>
              <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700,color:s.status==="PASS"?C.green:s.status==="FAIL"?C.red:C.gray}}>{s.status}</td>
            </tr>;
          })}
          {(()=>{const o=overallStat(mode,classId,st.id);return (
            <tr style={{background:"#dbeafe",fontWeight:700}}>
              <td style={{padding:"5px 8px"}}>Overall</td>
              <td style={{padding:"5px 8px",textAlign:"center"}}>{o.tot>0?`${o.obt}/${o.tot}`:"—"}</td>
              <td style={{padding:"5px 8px",textAlign:"center"}}>{o.pctStr==="—"?"—":`${o.pctStr}%`}</td>
              <td style={{padding:"5px 8px",textAlign:"center"}}>{o.gradeStr}</td>
              <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700,color:o.status==="PASS"?C.green:o.status==="FAIL"?C.red:C.gray}}>{o.status}</td>
            </tr>
          );})()}
        </tbody>
      </table></div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:24,paddingTop:12,borderTop:"1px solid #e5e7eb"}}>
        <div style={{textAlign:"center"}}><div style={{borderTop:"1px solid #374151",paddingTop:4,fontSize:11,width:130}}>{classTeacher||"Class Teacher"}</div></div>
        <div style={{textAlign:"center"}}><div style={{borderTop:"1px solid #374151",paddingTop:4,fontSize:11,width:130}}>{settings.principalName}</div></div>
      </div>
      </div>
    </div>;
  };

  return <div>
    <div className="no-print"><h2 style={{margin:"0 0 14px",color:C.navy,fontFamily:"Georgia,serif",fontSize:20}}>📝 {EXAM_TABS.find(t=>t.id===tab)?.l||"Examination"}</h2>
    <div style={{display:"flex",gap:6,marginBottom:14}}>{EXAM_TABS.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"7px 16px",borderRadius:5,border:"none",background:tab===t.id?C.navy:"#e5e7eb",color:tab===t.id?"#fff":"#374151",fontWeight:600,cursor:"pointer",fontSize:13}}>{t.l}</button>)}</div></div>

    {tab==="record"&&<StudentsPage settings={settings} students={students} setStudents={setStudents} embedded/>}
    {tab==="marks"&&<div>
      <div style={{display:"flex",gap:12,marginBottom:12,flexWrap:"wrap"}}>
        <Sel label="Exam" value={exam} onChange={setExam} options={exams}/>
        <Sel label="Class" value={selCls} onChange={setSelCls} options={settings.classes.map(c=>({value:c.id,label:c.name}))}/>
      </div>
      <div style={{overflowX:"auto"}}><table style={{borderCollapse:"collapse",fontSize:12}}>
        <thead>
          <tr style={{background:C.navy,color:"#fff"}}>
            {["Roll","Adm No","Name","Father",...subjs(selCls),"Total"].map(h=><th key={h} style={{padding:"7px 8px",whiteSpace:"nowrap"}}>{h}</th>)}
          </tr>
          <tr style={{background:"#e8edf8"}}>
            <td colSpan={4} style={{padding:"5px 8px",fontWeight:700,fontSize:11}}>Total Marks →</td>
            {subjs(selCls).map(s=><td key={s} style={{padding:"3px 3px"}}><input type="number" min="0" value={gtm(exam,selCls,s)} onChange={e=>stm(exam,selCls,s,e.target.value)} style={{width:58,padding:"4px",border:"1.5px solid #1a3a6b",borderRadius:4,fontSize:12,textAlign:"center",background:"#dbeafe"}}/></td>)}
            <td></td>
          </tr>
        </thead>
        <tbody>{cs(selCls).map((s,i)=>{const {obt,tot}=calc(exam,selCls,s.id);return(<tr key={s.id} style={{background:i%2===0?"#f9fafb":"#fff"}}>
          <td style={{padding:"5px 8px",fontWeight:700}}>{s.rollNo}</td><td style={{padding:"5px 8px"}}>{s.admissionNo}</td><td style={{padding:"5px 8px"}}>{s.name}</td><td style={{padding:"5px 8px"}}>{s.fatherName}</td>
          {subjs(selCls).map(subj=><td key={subj} style={{padding:"3px 3px"}}><input type="number" min="0" value={gom(exam,selCls,s.id,subj)} onChange={e=>som(exam,selCls,s.id,subj,e.target.value)} style={{width:58,padding:"4px",border:"1.5px solid #d1d5db",borderRadius:4,fontSize:12,textAlign:"center"}}/></td>)}
          <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700}}>{obt}/{tot||"—"}</td>
        </tr>);})}</tbody>
      </table></div>
    </div>}

    {tab==="consolidated"&&<div>
      <div style={{display:"flex",gap:12,marginBottom:12,flexWrap:"wrap"}}>
        <Sel label="Exam" value={exam} onChange={setExam} options={exams}/>
        <Sel label="Class" value={selCls} onChange={setSelCls} options={settings.classes.map(c=>({value:c.id,label:c.name}))}/>
      </div>
      <div style={{overflowX:"auto"}}><table style={{borderCollapse:"collapse",fontSize:12,width:"100%"}}>
        <thead><tr style={{background:C.navy,color:"#fff"}}>{["Roll","Adm No","Name","Photo","Father",...subjs(selCls),"Total","Pct","Grade","Pos"].map(h=><th key={h} style={{padding:"6px 8px",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
        <tbody>{cs(selCls).map(s=>({s,...calc(exam,selCls,s.id)})).sort((a,b)=>b.obt-a.obt).map(({s,obt,tot,pct},rank)=>(
          <tr key={s.id} style={{background:rank%2===0?"#f9fafb":"#fff"}}>
            <td style={{padding:"5px 8px",fontWeight:700}}>{s.rollNo}</td><td style={{padding:"5px 8px"}}>{s.admissionNo}</td><td style={{padding:"5px 8px"}}>{s.name}</td>
            <td style={{padding:4,verticalAlign:"middle"}}><div style={{width:36,height:44,border:"1px solid #d1d5db",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",background:"#f3f4f6"}}>{s.photo?<img src={s.photo} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:9,color:C.gray}}>Photo</span>}</div></td>
            <td style={{padding:"5px 8px"}}>{s.fatherName}</td>
            {subjs(selCls).map(subj=><td key={subj} style={{padding:"5px 8px",textAlign:"center"}}>{gom(exam,selCls,s.id,subj)||"—"}</td>)}
            <td style={{padding:"5px 8px",fontWeight:700,textAlign:"center"}}>{obt}/{tot||"—"}</td>
            <td style={{padding:"5px 8px",textAlign:"center"}}>{pct}%</td>
            <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700,color:parseFloat(pct)>=passThreshold?C.green:C.red}}>{grade(pct)}</td>
            <td style={{padding:"5px 8px",textAlign:"center",fontWeight:700}}>{rank+1}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>}

    {tab==="card"&&<div>
      <div className="no-print" style={{display:"flex",gap:12,marginBottom:12,flexWrap:"wrap",alignItems:"flex-end"}}>
        <Sel label="Class" value={rcCls} onChange={setRcCls} options={settings.classes.map(c=>({value:c.id,label:c.name}))}/>
        <Sel label="Exam" value={rcExam} onChange={setRcExam} options={[{value:"overall",label:"Overall (All Terms)"},...exams.map(e=>({value:e,label:e}))]}/>
        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          <label style={{fontSize:11,fontWeight:700,color:C.gray,textTransform:"uppercase",letterSpacing:0.4}}>Pass %</label>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={settings.passPercent ?? 50}
              onChange={e=>{
                const v=Number(e.target.value);
                if(!isNaN(v)&&v>=0&&v<=100&&setSettings) setSettings(s=>({...s,passPercent:v}));
              }}
              style={{padding:"6px 10px",border:"1.5px solid #d1d5db",borderRadius:5,fontSize:13,background:"#fff",width:72,boxSizing:"border-box"}}
            />
            <span style={{fontSize:13,color:C.gray,fontWeight:600}}>%</span>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"flex-end",gap:6}}>
          <button
            type="button"
            onClick={()=>{
              const n=parseInt(rcRoll||"0",10);
              if(isNaN(n)) { setRcRoll(""); return; }
              const next=Math.max(0,n-1);
              setRcRoll(String(next));
            }}
            style={{border:"1px solid #d1d5db",background:"#fff",borderRadius:4,padding:"6px 8px",cursor:"pointer",fontSize:13}}
          >
            ←
          </button>
          <Inp label="Roll No" value={rcRoll} onChange={setRcRoll} placeholder="Enter Roll No"/>
          <button
            type="button"
            onClick={()=>{
              const n=parseInt(rcRoll||"0",10);
              const base=isNaN(n)?0:n;
              const next=base+1;
              setRcRoll(String(next));
            }}
            style={{border:"1px solid #d1d5db",background:"#fff",borderRadius:4,padding:"6px 8px",cursor:"pointer",fontSize:13}}
          >
            →
          </button>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,paddingTop:16}}>
          <Btn small onClick={()=>{
            if(!rcRoll){ alert("Enter Roll No to print this card."); return; }
            window.print();
          }}>Print This Card</Btn>
          <Btn small outline onClick={()=>{
            const list=cs(rcCls);
            if(!list.length){ alert("No students in this class."); return; }
            setPrintCardsMode("class");
            setTimeout(()=>{ window.print(); setPrintCardsMode(null); },100);
          }}>Print Class Cards</Btn>
        </div>
      </div>
      {rcRoll&&(()=>{const st=cs(rcCls).find(s=>s.rollNo===rcRoll); if(!st) return <div style={{color:C.red,padding:16}}>Student not found for Roll No: {rcRoll}</div>;
        return renderResultCard(st,rcCls,rcExam);
      })()}
      {printCardsMode==="class"&&cs(rcCls).length>0&&(
        <div className="print-only" style={{display:"none",marginTop:12}}>
          {cs(rcCls).map(st=>renderResultCard(st,rcCls,rcExam))}
        </div>
      )}
    </div>}

    {tab==="datesheet"&&<div>
      <div className="no-print" style={{display:"flex",gap:12,marginBottom:12,flexWrap:"wrap",alignItems:"flex-end"}}>
        <Sel label="Exam" value={exam} onChange={setExam} options={exams}/>
        <Btn onClick={()=>setDsDates(rows=>[...rows,{id:genId(),date:new Date().toISOString().split("T")[0]}])}>+ Add Date</Btn>
        <Btn outline danger disabled={dsDates.length<=1} onClick={()=>setDsDates(rows=>rows.length>1?rows.slice(0,-1):rows)}>Remove Date</Btn>
        <Btn outline onClick={()=>setDsCols(cols=>[...cols,{id:genId(),classId:""}])}>+ Add Class Column</Btn>
        <Btn outline danger disabled={dsCols.length<=1} onClick={()=>setDsCols(cols=>cols.length>1?cols.slice(0,-1):cols)}>Remove Class Column</Btn>
        <div style={{marginLeft:"auto",paddingTop:2}}>
          <Btn outline onClick={()=>window.print()}>🖨️ Print Date Sheet</Btn>
        </div>
      </div>
      <div className="print-only" style={{display:"none",marginBottom:8}}>
        <SchoolHeader settings={settings} subtitle={`${exam} — EXAM DATE SHEET`}/>
      </div>
      <div style={{overflowX:"auto",background:"#fff",padding:12,borderRadius:8,border:"1px solid #e5e7eb"}}>
        <table className="datesheet-table" style={{borderCollapse:"collapse",fontSize:12,minWidth:0,margin:"0 auto"}}>
          <thead>
            <tr style={{background:C.navy,color:"#fff",textAlign:"center"}}>
              <th style={{padding:"4px 6px",border:"1px solid #000",minWidth:70,width:70,height:32,textAlign:"center"}}>Date</th>
              <th style={{padding:"4px 6px",border:"1px solid #000",minWidth:70,width:70,height:32,textAlign:"center"}}>Day</th>
              {dsCols.map(col=>{
                const usedIds=dsCols.filter(c=>c.id!==col.id).map(c=>c.classId).filter(Boolean);
                return <th key={col.id} style={{padding:"4px 6px",border:"1px solid #000",minWidth:70,width:70,height:32,textAlign:"center"}}>
                  <select
                    value={col.classId}
                    onChange={e=>{
                      const v=e.target.value;
                      setDsCols(cols=>cols.map(c=>c.id===col.id?{...c,classId:v}:c));
                    }}
                    style={{width:"100%",padding:"3px 4px",border:"1px solid #d1d5db",borderRadius:4,fontSize:11,textAlign:"center"}}
                  >
                    <option value="">— Select class —</option>
                    {settings.classes
                      .filter(cls=>!usedIds.includes(cls.id)||cls.id===col.classId)
                      .map(cls=><option key={cls.id} value={cls.id}>{cls.name}</option>)}
                  </select>
                </th>;
              })}
            </tr>
          </thead>
          <tbody>
            {dsDates.map(row=>{
              const dObj=row.date?new Date(row.date):null;
              const dayName=dObj&& !isNaN(dObj) ? dObj.toLocaleDateString("en-PK",{weekday:"long"}) : "";
              return <tr key={row.id}>
                <td style={{padding:"6px 8px",border:"1px solid #000",minWidth:70,width:70,height:32,textAlign:"center"}}>
                  <input
                    type="date"
                    value={row.date}
                    onChange={e=>setDsDates(rs=>rs.map(r=>r.id===row.id?{...r,date:e.target.value}:r))}
                    style={{width:"100%",padding:"2px 3px",border:"1px solid #d1d5db",borderRadius:4,fontSize:10,boxSizing:"border-box",textAlign:"center"}}
                  />
                </td>
                <td style={{padding:"6px 8px",border:"1px solid #000",fontWeight:700,minWidth:70,width:70,height:32,textAlign:"center"}}>{dayName}</td>
                {dsCols.map(col=>{
                  const cid=col.classId;
                  const key=`${row.id}_${col.id}`;
                  const current=dsSubs[key]||"";
                  const allSubs=cid?(settings.classSubjects[cid]||[]):[];
                  const usedSubs=dsDates
                    .map(r=>dsSubs[`${r.id}_${col.id}`])
                    .filter(s=>s && s!==current);
                  const options=allSubs.filter(s=>!usedSubs.includes(s));
                  return <td key={key} style={{padding:"6px 8px",border:"1px solid #000",minWidth:70,width:70,height:32,textAlign:"center"}}>
                    <select
                      value={current}
                      onChange={e=>{
                        const v=e.target.value;
                        setDsSubs(prev=>({...prev,[key]:v}));
                      }}
                      disabled={!cid}
                      style={{width:"100%",padding:"2px 3px",border:"1px solid #d1d5db",borderRadius:4,fontSize:10,background:cid?"#fff":"#f3f4f6",opacity:cid?1:0.7,textAlign:"center"}}
                    >
                      <option value="">---</option>
                      {options.map(s=><option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>;
                })}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:12}}>
        <label style={{fontSize:11,fontWeight:700,color:C.gray,display:"block",marginBottom:4}}>Note / Instructions</label>
        <textarea
          value={dsNote}
          onChange={e=>setDsNote(e.target.value)}
          rows={3}
          style={{width:"100%",padding:"6px 8px",border:"1.5px solid #d1d5db",borderRadius:6,fontSize:12,resize:"vertical",boxSizing:"border-box"}}
          placeholder="Write important instructions for students (e.g. reporting time, allowed materials, etc.)"
        />
      </div>
    </div>}
  </div>;
}

// ─── PAPER GENERATOR ─────────────────────────────────────────────────────────
const PAPER_TYPES=[{id:"regular",label:"Regular Paper"},{id:"english",label:"English Medium Paper"},{id:"urdu",label:"Urdu Medium Paper"},{id:"englishLang",label:"English Language Paper"},{id:"urduLang",label:"Urdu Language Paper"}];
function PaperGeneratorPage({settings}){
  const [paperType,setPaperType]=useState("regular");
  const [selCls,setSelCls]=useState(settings.classes[0]?.id||"");
  const [subj,setSubj]=useState("");
  const [exam,setExam]=useState("Annual");
  const [time,setTime]=useState(180);
  const [preview,setPreview]=useState(false);
  const [printPaperMode,setPrintPaperMode]=useState(false);
  useEffect(()=>{
    if(printPaperMode)document.body.classList.add("printing-paper");
    else document.body.classList.remove("printing-paper");
    return ()=>document.body.classList.remove("printing-paper");
  },[printPaperMode]);
  useEffect(()=>{
    const onAfter=()=>setPrintPaperMode(false);
    window.addEventListener("afterprint",onAfter);
    return ()=>window.removeEventListener("afterprint",onAfter);
  },[]);
  const [sections,setSections]=useState([
    {id:1,title:"Section A – Objective",type:"MCQs",marks:20,instructions:"",questions:[{id:genId(),text:"",options:["","","",""],correct:0}]},
    {id:2,title:"Section B – Short Questions",type:"Short",marks:40,instructions:"",questions:[{id:genId(),text:""}]},
    {id:3,title:"Section C – Long Questions",type:"Long",marks:40,instructions:"",questions:[{id:genId(),text:""}]},
  ]);
  const subs=settings.classSubjects[selCls]||[];
  useEffect(()=>{if(subs.length)setSubj(subs[0]);},[selCls]);
  const addQ=(sid)=>setSections(s=>s.map(sec=>sec.id===sid?{...sec,questions:[...sec.questions,{id:genId(),text:"",...(sec.type==="MCQs"?{options:["","","",""],correct:0}:{})}]}:sec));
  const rmQ=(sid,qid)=>setSections(s=>s.map(sec=>sec.id===sid?{...sec,questions:sec.questions.filter(q=>q.id!==qid)}:sec));
  const upQ=(sid,qid,f,v)=>setSections(s=>s.map(sec=>sec.id===sid?{...sec,questions:sec.questions.map(q=>q.id===qid?{...q,[f]:v}:q)}:sec));
  const total=sections.reduce((a,s)=>a+(parseInt(s.marks)||0),0);
  const paperContent=<>
    <SchoolHeader settings={settings} subtitle={`${exam} — ${subj} — Class ${selCls}`}/>
    <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,fontSize:13}}>
      <span>Total Marks: <strong>{total}</strong></span><span>Time: <strong>{time} minutes</strong></span>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,padding:"6px 0",marginBottom:8,fontSize:12}}>
      <span>Name: ___________</span><span>Roll No: ___________</span><span>Date: ___________</span>
    </div>
    <div style={{borderTop:"3px solid #000",marginBottom:14}}/>
    {sections.map((sec,si)=><div key={si} className="paper-section" style={{marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",borderBottom:"1px solid #000",marginBottom:6,fontWeight:700,fontSize:14}}><span>{sec.title}</span><span>Marks: <strong>{sec.marks}</strong></span></div>
      <p style={{fontStyle:"italic",margin:"0 0 8px",fontSize:12}}>{sec.instructions}</p>
      {sec.type==="Short"
        ? (<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",columnGap:20,rowGap:6}}>
            {sec.questions.map((q,qi)=><div key={qi} style={{marginBottom:4}}><p style={{margin:"0 0 2px",fontSize:13}}><strong>Q{qi+1}.</strong> {q.text||"(question)"}</p></div>)}
          </div>)
        : sec.questions.map((q,qi)=><div key={qi} style={{marginBottom:8}}>
            <p style={{margin:"0 0 4px",fontSize:13}}><strong>Q{qi+1}.</strong> {q.text||"(question)"}</p>
            {sec.type==="MCQs"&&q.options&&<div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:2,fontSize:12,marginLeft:16}}>{q.options.map((o,oi)=><span key={oi}>({String.fromCharCode(65+oi)}) {o||`Option ${String.fromCharCode(65+oi)}`}</span>)}</div>}
          </div>)
      }
    </div>)}
    <div style={{textAlign:"center",borderTop:"1px solid #000",paddingTop:8,marginTop:16}}>
      <span style={{fontSize:12,fontStyle:"italic"}}>End of Paper</span>
    </div>
  </>;
  return <div>
    {printPaperMode&&<div className="paper-print-only" style={{position:"absolute",left:"-9999px",top:0,width:"100%",padding:20,fontFamily:(paperType==="urdu"||paperType==="urduLang")?"'Jameel Noori Nastaliq Regular','Jameel Noori Nastaliq',serif":"Georgia,serif",direction:(paperType==="urdu"||paperType==="urduLang")?"rtl":"ltr",textAlign:(paperType==="urdu"||paperType==="urduLang")?"right":"left",fontSize:(paperType==="urdu"||paperType==="urduLang")?14:undefined,boxSizing:"border-box"}}>{paperContent}</div>}
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <h2 style={{margin:0,color:C.navy,fontFamily:"Georgia,serif",fontSize:20}}>📄 {PAPER_TYPES.find(t=>t.id===paperType)?.label||"Paper Generator"}</h2>
      <div style={{display:"flex",gap:8}}>
        <Btn outline onClick={()=>setPreview(true)}>👁️ Preview</Btn>
        <Btn onClick={()=>{ setPrintPaperMode(true); setTimeout(()=>window.print(),150); }}>🖨️ Print Paper</Btn>
      </div>
    </div>
    <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
      {PAPER_TYPES.map(t=><button key={t.id} onClick={()=>setPaperType(t.id)} style={{padding:"8px 14px",borderRadius:6,border:paperType===t.id?"2px solid "+C.navy:"1px solid #d1d5db",background:paperType===t.id?C.navyL:"#fff",color:paperType===t.id?C.navy:"#374151",fontWeight:paperType===t.id?700:500,fontSize:13,cursor:"pointer"}}>{t.label}</button>)}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:10,marginBottom:12}}>
      <Sel label="Class" value={selCls} onChange={setSelCls} options={settings.classes.map(c=>({value:c.id,label:c.name}))}/>
      <Sel label="Subject" value={subj} onChange={setSubj} options={subs}/>
      <Sel label="Exam" value={exam} onChange={setExam} options={["1st Term","Mid Term","Final Term","Annual"]}/>
      <Inp label="Time (min)" type="number" value={time} onChange={v=>setTime(+v)}/>
    </div>
    <div style={{padding:"6px 12px",background:"#fef3c7",borderRadius:5,fontSize:12,color:"#92400e",fontWeight:700,marginBottom:12,marginTop:6}}>Total Marks: {total}</div>
    {sections.map(sec=><div key={sec.id} style={{border:"1.5px solid #e5e7eb",borderRadius:8,marginBottom:14,overflow:"hidden"}}>
      <div style={{background:C.navy,color:"#fff",padding:"8px 12px",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <input value={sec.title} onChange={e=>setSections(s=>s.map(x=>x.id===sec.id?{...x,title:e.target.value}:x))} style={{background:"transparent",border:"none",color:"#fff",fontSize:13,fontWeight:700,flex:1,outline:"none"}}/>
        <input type="number" value={sec.marks} onChange={e=>setSections(s=>s.map(x=>x.id===sec.id?{...x,marks:+e.target.value}:x))} style={{width:55,padding:"3px 6px",borderRadius:4,border:"none",fontSize:12,textAlign:"center"}}/>
        <span style={{fontSize:11}}>marks</span>
      </div>
      <div style={{padding:10}}>
        <input value={sec.instructions} onChange={e=>setSections(s=>s.map(x=>x.id===sec.id?{...x,instructions:e.target.value}:x))} placeholder="Instructions…" style={{width:"100%",padding:"5px 8px",border:"1px solid #d1d5db",borderRadius:5,fontSize:12,marginBottom:8,boxSizing:"border-box"}}/>
        {sec.questions.map((q,qi)=><div key={q.id} style={{background:"#f9fafb",borderRadius:6,padding:8,marginBottom:6}}>
          <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
            <span style={{fontWeight:700,color:C.navy,minWidth:22,paddingTop:6,fontSize:12}}>Q{qi+1}.</span>
            <textarea value={q.text} onChange={e=>upQ(sec.id,q.id,"text",e.target.value)} placeholder="Question…" style={{flex:1,padding:"5px 8px",border:"1px solid #d1d5db",borderRadius:5,fontSize:12,resize:"vertical",minHeight:44}}/>
            <Btn small danger onClick={()=>rmQ(sec.id,q.id)}>×</Btn>
          </div>
          {sec.type==="MCQs"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginTop:4,marginLeft:28}}>
            {q.options.map((opt,oi)=><div key={oi} style={{display:"flex",alignItems:"center",gap:4}}>
              <input type="radio" name={`cr_${q.id}`} checked={q.correct===oi} onChange={()=>upQ(sec.id,q.id,"correct",oi)}/>
              <input value={opt} onChange={e=>{const opts=[...q.options];opts[oi]=e.target.value;upQ(sec.id,q.id,"options",opts);}} placeholder={`Opt ${String.fromCharCode(65+oi)}`} style={{flex:1,padding:"3px 6px",border:"1px solid #d1d5db",borderRadius:4,fontSize:11}}/>
            </div>)}
          </div>}
        </div>)}
        <Btn small outline color={C.navy} onClick={()=>addQ(sec.id)}>+ Add Question</Btn>
      </div>
    </div>)}
    {preview&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:780,maxHeight:"90vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
        <div className="no-print" style={{background:C.navy,color:"#fff",padding:"12px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontWeight:700}}>Paper Preview</span>
          <button onClick={()=>setPreview(false)} style={{background:"none",border:"none",color:"#fff",fontSize:20,cursor:"pointer"}}>×</button>
        </div>
        <div style={{padding:20,fontFamily:(paperType==="urdu"||paperType==="urduLang")?"'Jameel Noori Nastaliq Regular','Jameel Noori Nastaliq',serif":"Georgia,serif",direction:(paperType==="urdu"||paperType==="urduLang")?"rtl":"ltr",textAlign:(paperType==="urdu"||paperType==="urduLang")?"right":"left",fontSize:(paperType==="urdu"||paperType==="urduLang")?14:undefined}}>{paperContent}</div>
      </div>
    </div>}
  </div>;
}

// ─── STUDENTS PAGE ────────────────────────────────────────────────────────────
function StudentsPage({settings,students,setStudents,embedded}){
  const [showAdd,setShowAdd]=useState(false);
  const [editingId,setEditingId]=useState(null);
  const [filterCls,setFilterCls]=useState("all");
  const [search,setSearch]=useState("");
  const emptyForm={admissionNo:"",rollNo:"",name:"",fatherName:"",classId:settings.classes[0]?.id||"",dob:"",bayForm:"",fatherCnic:"",whatsapp:"",photo:null};
  const [form,setForm]=useState(emptyForm);
  const photoRef=useRef();
  const filtered=students.filter(s=>(filterCls==="all"||s.classId===filterCls)&&(!search||(s.name.toLowerCase().includes(search.toLowerCase())||s.admissionNo.includes(search))));
  const formatDob=(v)=>{
    const digits=String(v||"").replace(/\D/g,"").slice(0,8);
    const len=digits.length;
    if(!len) return "";
    if(len<=2) return digits;
    if(len<=4) return `${digits.slice(0,2)}/${digits.slice(2)}`;
    return `${digits.slice(0,2)}/${digits.slice(2,4)}/${digits.slice(4)}`;
  };
  const openAdd=()=>{ setEditingId(null); setForm(emptyForm); setShowAdd(true); };
  const openEdit=(s)=>{ setEditingId(s.id); setForm({admissionNo:s.admissionNo||"",rollNo:s.rollNo||"",name:s.name||"",fatherName:s.fatherName||"",classId:s.classId||"",dob:formatDob(s.dob||""),bayForm:s.bayForm||"",fatherCnic:s.fatherCnic||"",whatsapp:s.whatsapp||"",photo:s.photo||null}); setShowAdd(true); };
  const save=()=>{if(!form.name||!form.admissionNo)return;if(editingId){setStudents(s=>s.map(st=>st.id===editingId?{...form,id:editingId}:st));}else{setStudents(s=>[...s,{...form,id:genId()}]);}setForm(emptyForm);setEditingId(null);setShowAdd(false);};
  const closeModal=()=>{ setShowAdd(false); setEditingId(null); setForm(emptyForm); };
  const formatCnic=(v)=>{ const d=(v||"").replace(/\D/g,"").slice(0,13); if(d.length<=5)return d; if(d.length<=12)return d.slice(0,5)+"-"+d.slice(5); return d.slice(0,5)+"-"+d.slice(5,12)+"-"+d.slice(12); };
  const formatWhatsapp=(v)=>{ const d=(v||"").replace(/\D/g,"").slice(0,11); if(d.length<=4)return d; return d.slice(0,4)+"-"+d.slice(4); };
  const printSubtitle = embedded
    ? "Student Record" + (filterCls !== "all" ? " - " + (settings.classes.find(c=>c.id===filterCls)?.name || "") : " - All Classes")
    : null;
  return <div>
    {embedded&&<div className="print-only" style={{display:"none",marginBottom:10}}><SchoolHeader settings={settings} subtitle={printSubtitle}/></div>}
    {!embedded&&<h2 style={{margin:"0 0 14px",color:C.navy,fontFamily:"Georgia,serif",fontSize:20}}>👨‍🎓 Students Record</h2>}
    <div className="no-print" style={{display:"flex",gap:12,marginBottom:14,flexWrap:"wrap",alignItems:"flex-end"}}>
      <Sel label="Filter by Class" value={filterCls} onChange={setFilterCls} options={[{value:"all",label:"All Classes"},...settings.classes.map(c=>({value:c.id,label:c.name}))]}/>
      <Inp label="Search" value={search} onChange={setSearch} placeholder="Name or Adm No…"/>
      <div style={{marginLeft:"auto",display:"flex",gap:8}}><Btn onClick={openAdd}>+ Add Student</Btn><Btn outline onClick={()=>window.print()}>🖨️ Print</Btn></div>
    </div>
    <div className="no-print" style={{fontSize:12,color:C.gray,marginBottom:8}}>Showing {filtered.length} of {students.length} students</div>
    <div className="students-record-print" style={{overflowX:"auto"}}>
      <table style={{borderCollapse:"collapse",fontSize:13,width:"100%"}}>
        <thead><tr style={{background:C.navy,color:"#fff"}}>{["Photo","Adm No","Roll","Name","Father's Name","Bay Form","Father's CNIC","WhatsApp No","Class","DOB","Action"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
        <tbody>{filtered.map((s,i)=><tr key={s.id} style={{background:i%2===0?"#f9fafb":"#fff"}}>
          <td style={{padding:"5px 10px"}}><div style={{width:34,height:34,borderRadius:"50%",overflow:"hidden",border:"2px solid #d1d5db",background:"#e5e7eb",display:"flex",alignItems:"center",justifyContent:"center"}}>{s.photo?<img src={s.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:"👤"}</div></td>
          <td style={{padding:"5px 10px"}}>{s.admissionNo}</td><td style={{padding:"5px 10px",fontWeight:700}}>{s.rollNo}</td><td style={{padding:"5px 10px"}}>{s.name}</td><td style={{padding:"5px 10px"}}>{s.fatherName}</td>
          <td style={{padding:"5px 10px"}}>{s.bayForm?formatCnic(s.bayForm):"—"}</td><td style={{padding:"5px 10px"}}>{s.fatherCnic?formatCnic(s.fatherCnic):"—"}</td><td style={{padding:"5px 10px"}}>{s.whatsapp?formatWhatsapp(s.whatsapp):"—"}</td>
          <td style={{padding:"5px 10px"}}>{settings.classes.find(c=>c.id===s.classId)?.name}</td><td style={{padding:"5px 10px"}}>{s.dob}</td>
          <td style={{padding:"5px 10px"}}><div style={{display:"flex",flexDirection:"column",gap:4}}><Btn small outline onClick={()=>openEdit(s)}>Edit</Btn><Btn small danger onClick={()=>setStudents(x=>x.filter(st=>st.id!==s.id))}>Remove</Btn></div></td>
        </tr>)}
        {filtered.length===0&&<tr><td colSpan={11} style={{padding:20,textAlign:"center",color:C.gray}}>No students found</td></tr>}
        </tbody>
      </table>
    </div>
    {showAdd&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:10,width:"100%",maxWidth:560,maxHeight:"90vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.3)"}}>
        <div style={{background:C.navy,color:"#fff",padding:"12px 18px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontWeight:700}}>{editingId?"Edit Student":"Add New Student"}</span>
          <button onClick={closeModal} style={{background:"none",border:"none",color:"#fff",fontSize:20,cursor:"pointer"}}>×</button>
        </div>
        <div style={{padding:20}}>
          <div style={{display:"flex",gap:16,alignItems:"flex-start",marginBottom:14}}>
            <div onClick={()=>photoRef.current.click()} style={{width:80,height:100,border:"2px dashed #d1d5db",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",flexShrink:0}}>
              {form.photo?<img src={form.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontSize:10,color:C.gray,textAlign:"center"}}>Click<br/>Photo</span>}
            </div>
            <input ref={photoRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setForm(x=>({...x,photo:ev.target.result}));r.readAsDataURL(f);}}/>
            <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <Inp label="Admission No" value={form.admissionNo} onChange={v=>setForm(x=>({...x,admissionNo:v}))}/>
              <Inp label="Roll No" value={form.rollNo} onChange={v=>setForm(x=>({...x,rollNo:v}))}/>
              <Inp label="Student Name" value={form.name} onChange={v=>setForm(x=>({...x,name:v}))}/>
              <Inp label="Father's Name" value={form.fatherName} onChange={v=>setForm(x=>({...x,fatherName:v}))}/>
              <Inp label="Bay Form" value={form.bayForm} onChange={v=>setForm(x=>({...x,bayForm:formatCnic(v)}))} placeholder="00000-0000000-0"/>
              <Inp label="Father's CNIC" value={form.fatherCnic} onChange={v=>setForm(x=>({...x,fatherCnic:formatCnic(v)}))} placeholder="00000-0000000-0"/>
              <Inp label="WhatsApp No" value={form.whatsapp} onChange={v=>setForm(x=>({...x,whatsapp:formatWhatsapp(v)}))} placeholder="0000-0000000"/>
              <Sel label="Class" value={form.classId} onChange={v=>setForm(x=>({...x,classId:v}))} options={settings.classes.map(c=>({value:c.id,label:c.name}))}/>
              <Inp label="Date of Birth" value={form.dob} onChange={v=>setForm(x=>({...x,dob:formatDob(v)}))} placeholder="dd/mm/yyyy"/>
            </div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn outline color={C.gray} onClick={closeModal}>Cancel</Btn><Btn onClick={save}>Save</Btn></div>
        </div>
      </div>
    </div>}
  </div>;
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function DashboardPage({settings,students}){
  const [selectedClassId,setSelectedClassId]=useState(settings.classes[0]?.id||"");
  const stats=[{l:"Total Students",v:students.length,i:"👨‍🎓",c:C.navy},{l:"Classes",v:settings.classes.length,i:"🏫",c:"#0d9488"},{l:"Staff",v:settings.staff.length,i:"👨‍🏫",c:"#7c3aed"},{l:"Periods/Day",v:settings.periodsPerDay,i:"⏰",c:C.gold}];
  const hasSchoolData=settings.classes.length>0 && settings.staff.length>0 && students.length>0;
  const passThreshold=Number(settings.passPercent)||50;
  const exams=["1st Term","Mid Term","Final Term","Annual"];
  const suffix=(settings.schoolCode||settings.schoolName||"default").replace(/[^a-zA-Z0-9_-]/g,"_");
  const tmKey=`exam_TM_${suffix}`;
  const omKey=`exam_OM_${suffix}`;
  let TM={},OM={};
  try{
    if(typeof window!=="undefined"){
      const rawTM=window.localStorage.getItem(tmKey);
      const rawOM=window.localStorage.getItem(omKey);
      if(rawTM){ const p=JSON.parse(rawTM); if(p&&typeof p==="object") TM=p; }
      if(rawOM){ const p=JSON.parse(rawOM); if(p&&typeof p==="object") OM=p; }
    }
  }catch(e){}
  const gtm=(e,c,s)=>TM[`${e}_${c}_${s}`]||"";
  const gom=(e,c,id,s)=>OM[`${e}_${c}_${id}_${s}`]||"";
  const classStats=settings.classes.map(cls=>{
    const classStudents=students.filter(s=>s.classId===cls.id);
    const count=classStudents.length;
    const subjs=settings.classSubjects[cls.id]||[];
    let pass=0,fail=0;
    classStudents.forEach(st=>{
      let tot=0,obt=0;
      exams.forEach(e=>{
        subjs.forEach(subj=>{
          const t=parseFloat(gtm(e,cls.id,subj));
          const o=parseFloat(gom(e,cls.id,st.id,subj));
          if(!isNaN(t)) tot+=t;
          if(!isNaN(o)) obt+=o;
        });
      });
      if(tot>0){
        const pct=(obt/tot)*100;
        if(pct>=passThreshold) pass++; else fail++;
      }
    });
    return {id:cls.id,name:cls.name,grade:cls.grade,section:cls.section,count,pass,fail};
  });
  const selectedRow=classStats.find(r=>r.id===selectedClassId)||{count:0,pass:0,fail:0,name:""};
  return <div>
    <style>{`
      .dash-stat-card{ transition:transform 0.2s ease,box-shadow 0.2s ease; }
      .dash-stat-card:hover{ transform:translateY(-2px); box-shadow:0 8px 24px rgba(0,0,0,0.1); }
      .dash-class-card{ transition:transform 0.2s ease,box-shadow 0.2s ease; }
      .dash-class-card:hover{ transform:translateY(-1px); box-shadow:0 4px 12px rgba(0,0,0,0.08); }
      .dash-select{ transition:border-color 0.2s ease,box-shadow 0.2s ease; }
      .dash-select:focus{ outline:none; border-color:#1a3a6b; box-shadow:0 0 0 3px rgba(26,58,107,0.15); }
    `}</style>
    <h2 style={{margin:"0 0 18px",color:C.navy,fontFamily:"Georgia,serif",fontSize:22,fontWeight:700}}>Welcome to {settings.schoolName}</h2>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:16,marginBottom:22}}>
      {stats.map(s=><div key={s.l} className="dash-stat-card" style={{background:"#fff",borderRadius:12,padding:20,boxShadow:"0 2px 12px rgba(0,0,0,0.06),0 1px 3px rgba(0,0,0,0.04)",borderLeft:`4px solid ${s.c}`,border:"1px solid rgba(0,0,0,0.04)",borderLeftWidth:4,borderLeftColor:s.c}}>
        <div style={{fontSize:28,marginBottom:4,opacity:0.95}}>{s.i}</div>
        <div style={{fontSize:34,fontWeight:700,color:s.c,letterSpacing:"-0.02em",lineHeight:1.2}}>{s.v}</div>
        <div style={{fontSize:12,color:C.gray,marginTop:4,fontWeight:500,letterSpacing:0.2}}>{s.l}</div>
      </div>)}
    </div>
    {settings.classes.length>0&&<div className="dash-stat-card" style={{background:"#fff",borderRadius:12,padding:14,boxShadow:"0 2px 12px rgba(0,0,0,0.06),0 1px 3px rgba(0,0,0,0.04)",marginBottom:18,maxWidth:280,border:"1px solid rgba(0,0,0,0.04)"}}>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <select
          className="dash-select"
          value={selectedClassId}
          onChange={e=>setSelectedClassId(e.target.value)}
          style={{padding:"6px 10px",border:"1.5px solid #e5e7eb",borderRadius:8,fontSize:12,background:"#fafafa",width:"100%",maxWidth:252,boxSizing:"border-box",fontWeight:600,color:"#374151"}}
        >
          {settings.classes.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
          <div className="dash-class-card" style={{background:"#fafbfc",borderRadius:10,padding:12,boxShadow:"0 1px 6px rgba(0,0,0,0.05)",borderLeft:"4px solid "+C.navy,border:"1px solid rgba(0,0,0,0.04)",borderLeftWidth:4,borderLeftColor:C.navy}}>
            <div style={{fontSize:18,marginBottom:2}}>👨‍🎓</div>
            <div style={{fontSize:24,fontWeight:700,color:C.navy,letterSpacing:"-0.02em"}}>{selectedRow.count}</div>
            <div style={{fontSize:11,color:C.gray,fontWeight:500}}>Total Students</div>
          </div>
          <div className="dash-class-card" style={{background:"#fafbfc",borderRadius:10,padding:12,boxShadow:"0 1px 6px rgba(0,0,0,0.05)",borderLeft:"4px solid "+C.green,border:"1px solid rgba(0,0,0,0.04)",borderLeftWidth:4,borderLeftColor:C.green}}>
            <div style={{fontSize:18,marginBottom:2}}>✅</div>
            <div style={{fontSize:24,fontWeight:700,color:C.green,letterSpacing:"-0.02em"}}>{selectedRow.pass}</div>
            <div style={{fontSize:11,color:C.gray,fontWeight:500}}>Pass</div>
          </div>
          <div className="dash-class-card" style={{background:"#fafbfc",borderRadius:10,padding:12,boxShadow:"0 1px 6px rgba(0,0,0,0.05)",borderLeft:"4px solid "+C.red,border:"1px solid rgba(0,0,0,0.04)",borderLeftWidth:4,borderLeftColor:C.red}}>
            <div style={{fontSize:18,marginBottom:2}}>❌</div>
            <div style={{fontSize:24,fontWeight:700,color:C.red,letterSpacing:"-0.02em"}}>{selectedRow.fail}</div>
            <div style={{fontSize:11,color:C.gray,fontWeight:500}}>Fail</div>
          </div>
        </div>
      </div>
    </div>}
    <div style={{background:"#fff",borderRadius:10,padding:18,boxShadow:"0 2px 8px rgba(0,0,0,0.07)",maxWidth:780,marginBottom:18}}>
      <h3 style={{margin:"0 0 10px",color:C.navy,fontSize:14}}>👨‍🎓 Students per Class</h3>
      {settings.classes.length===0&&<div style={{fontSize:12,color:C.gray}}>No classes added yet. Add classes in Settings → Classes &amp; Subjects.</div>}
      {settings.classes.length>0&&<div style={{maxHeight:260,overflowY:"auto",borderTop:"1px solid #eef2f7",marginTop:6}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr style={{background:"#f3f4f6",color:"#374151"}}>
              <th style={{textAlign:"left",padding:"6px 8px",borderBottom:"1px solid #e5e7eb",width:"20%"}}>Class ID</th>
              <th style={{textAlign:"left",padding:"6px 8px",borderBottom:"1px solid #e5e7eb",width:"32%"}}>Class Name</th>
              <th style={{textAlign:"right",padding:"6px 8px",borderBottom:"1px solid #e5e7eb",width:"16%"}}>Students</th>
              <th style={{textAlign:"right",padding:"6px 8px",borderBottom:"1px solid #e5e7eb",width:"16%"}}>Pass</th>
              <th style={{textAlign:"right",padding:"6px 8px",borderBottom:"1px solid #e5e7eb",width:"16%"}}>Fail</th>
            </tr>
          </thead>
          <tbody>
            {classStats.map(row=>(
              <tr key={row.id} style={{background:"#fff"}}>
                <td style={{padding:"5px 8px",borderBottom:"1px solid #f3f4f6",fontSize:11,color:C.gray}}>{row.id}</td>
                <td style={{padding:"5px 8px",borderBottom:"1px solid #f3f4f6",fontWeight:600}}>{row.name}</td>
                <td style={{padding:"5px 8px",borderBottom:"1px solid #f3f4f6",textAlign:"right",fontWeight:700,color:C.navy}}>{row.count}</td>
                <td style={{padding:"5px 8px",borderBottom:"1px solid #f3f4f6",textAlign:"right",fontWeight:600,color:C.green}}>{row.pass}</td>
                <td style={{padding:"5px 8px",borderBottom:"1px solid #f3f4f6",textAlign:"right",fontWeight:600,color:C.red}}>{row.fail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </div>
    <div style={{background:"#fff",borderRadius:10,padding:18,boxShadow:"0 2px 8px rgba(0,0,0,0.07)",maxWidth:780}}>
      <h3 style={{margin:"0 0 12px",color:C.navy,fontSize:14}}>📊 Teacher–Subject Pass Percentage</h3>
      {!hasSchoolData && (
        <div style={{fontSize:12,color:C.gray}}>
          Add classes, students, staff, and enter exam marks in the Examination tab to see real‑time pass percentage analytics here.
        </div>
      )}
      {hasSchoolData && (
        <div style={{fontSize:12,color:C.gray}}>
          Pass‑percentage graph will appear here once exam results are saved centrally. (Current version does not yet compute pass %
          from Examination marks.)
        </div>
      )}
    </div>
  </div>;
}

// ─── PRINT STYLES ─────────────────────────────────────────────────────────────
const PRINT_CSS=`@media print {
  @page{size:A4 portrait;margin:8mm}
  @page landscape{size:A4 landscape;margin:8mm}
  @page paperPortrait{size:A4 portrait;margin:0.5mm}
  @page resultCard{size:A4 portrait;margin:0.5mm}
  #print-section .by-teacher-print{page:portrait}
  body.printing-all-teachers #print-section .by-teacher-single{display:none!important}
  body.printing-all-teachers #print-section .by-teacher-print-all .by-teacher-print{page:portrait}
  body.printing-all-classes #print-section .by-class-single{display:none!important}
  body *{visibility:hidden}
  #print-section,#print-section *{visibility:visible}
  #print-section{position:absolute;top:0;left:0;width:100%;max-width:297mm;padding:0;box-sizing:border-box}
  .no-print{display:none!important}
  #print-section .print-only{display:block!important}
  #print-section table{border-collapse:collapse;border:1px solid #000}
  #print-section th,#print-section td{border:1px solid #000}
  #print-section .datesheet-table input,
  #print-section .datesheet-table select{
    border:none!important;
    background:transparent!important;
    box-shadow:none!important;
    -webkit-appearance:none!important;
    appearance:none!important;
    padding:0!important;
  }
  #print-section .datesheet-table select option{background:#fff;color:#000}
  #print-section .tt-empty-plus{display:none!important}
  body.printing-paper #print-section *{visibility:hidden!important}
  body.printing-paper #print-section .paper-print-only,body.printing-paper #print-section .paper-print-only *{visibility:visible!important}
  body.printing-paper #print-section .paper-print-only{position:static!important;left:0!important;display:block!important;width:100%!important;max-width:186mm;margin:0 auto;padding:0;box-sizing:border-box;page:paperPortrait}
  body.printing-paper #print-section .paper-print-only *{box-sizing:border-box}
  body.printing-paper #print-section .paper-print-only .paper-section{page-break-inside:avoid}
  #print-section .students-record-print table th:last-child,#print-section .students-record-print table td:last-child{display:none!important}
}`;

// ─── LOCAL PERSISTENCE ────────────────────────────────────────────────────────
const LOCAL_DATA_KEY = "system_management_local_data";
function loadFromLocal(){
  try {
    if(typeof window==="undefined") return null;
    const raw=window.localStorage.getItem(LOCAL_DATA_KEY);
    if(!raw) return null;
    const data=JSON.parse(raw);
    if(!data||!Array.isArray(data.schools)||data.schools.length===0) return null;
    const schools=data.schools.map(s=>({
      id:s.id||genId(),
      name:s.name||"School",
      settings:s.settings||defaultSettings,
      students:Array.isArray(s.students)?s.students:defaultStudents,
      timetable:s.timetable&&typeof s.timetable==="object"?s.timetable:{},
      exam_tm:s.exam_tm&&typeof s.exam_tm==="object"?s.exam_tm:{},
      exam_om:s.exam_om&&typeof s.exam_om==="object"?s.exam_om:{},
    }));
    schools.forEach(s=>{
      const suffix=(s.settings?.schoolCode||s.settings?.schoolName||"default").replace(/[^a-zA-Z0-9_-]/g,"_");
      try{
        if(s.exam_tm&&Object.keys(s.exam_tm).length) window.localStorage.setItem("exam_TM_"+suffix,JSON.stringify(s.exam_tm));
        if(s.exam_om&&Object.keys(s.exam_om).length) window.localStorage.setItem("exam_OM_"+suffix,JSON.stringify(s.exam_om));
      }catch(e){}
    });
    const activeSchoolId=data.activeSchoolId&&schools.some(sc=>sc.id===data.activeSchoolId)?data.activeSchoolId:schools[0].id;
    return { schools, activeSchoolId };
  } catch(e){ return null; }
}
function saveToLocal(schools,activeSchoolId){
  try {
    if(typeof window==="undefined") return;
    const toSave=(schools||[]).map(s=>{
      const suffix=(s.settings?.schoolCode||s.settings?.schoolName||"default").replace(/[^a-zA-Z0-9_-]/g,"_");
      let exam_tm=s.exam_tm||{},exam_om=s.exam_om||{};
      try{
        const rawTM=window.localStorage.getItem("exam_TM_"+suffix);
        const rawOM=window.localStorage.getItem("exam_OM_"+suffix);
        if(rawTM){ const p=JSON.parse(rawTM); if(p&&typeof p==="object") exam_tm=p; }
        if(rawOM){ const p=JSON.parse(rawOM); if(p&&typeof p==="object") exam_om=p; }
      }catch(e){}
      return { id:s.id,name:s.name,settings:s.settings,students:s.students,timetable:s.timetable||{},exam_tm,exam_om };
    });
    window.localStorage.setItem(LOCAL_DATA_KEY,JSON.stringify({ schools:toSave, activeSchoolId:activeSchoolId||null }));
  } catch(e){}
}

// ─── APP ROOT ─────────────────────────────────────────────────────────────────
function schoolShape(id,name){
  return {id,name,settings:defaultSettings,students:defaultStudents,timetable:{},exam_tm:{},exam_om:{}};
}
function App(){
  const [page,setPage]=useState("dashboard");
  const [schools,setSchools]=useState(()=>{
    if(SUPABASE_ENABLED){ const id=genId(); return [schoolShape(id,"School 1")]; }
    const data=loadFromLocal();
    if(data&&data.schools.length) return data.schools;
    const id=genId();
    return [schoolShape(id,"School 1")];
  });
  const [activeSchoolId,setActiveSchoolId]=useState(()=>{
    if(SUPABASE_ENABLED){ try{ const s=localStorage.getItem("activeSchoolId"); return s||null; }catch(e){ return null; } }
    const data=loadFromLocal();
    if(data) return data.activeSchoolId;
    return null;
  });
  const [loadedFromDb,setLoadedFromDb]=useState(false);
  const skipPersistRef=useRef(false);

  const activeSchool=schools.find(s=>s.id===activeSchoolId)||schools[0]||schoolShape(genId(),"School 1");
  const settings=activeSchool.settings;
  const students=activeSchool.students;
  const timetable=activeSchool.timetable||{};
  const setTimetable=(updater)=>{
    setSchools(prev=>prev.map(s=>s.id===activeSchoolId?{...s,timetable:typeof updater==="function"?updater(s.timetable||{}):updater}:s));
  };

  useEffect(()=>{
    if(!SUPABASE_ENABLED){ setLoadedFromDb(true); return; }
    let cancelled=false;
    loadSchools()
      .then(async (rows)=>{
        if(cancelled) return;
        if(rows&&rows.length>0){
          const mapped=rows.map(r=>({
            id:r.id,
            name:r.name||"School 1",
            settings:r.settings||defaultSettings,
            students:r.students||defaultStudents,
            timetable:r.timetable||{},
            exam_tm:r.exam_tm||{},
            exam_om:r.exam_om||{},
          }));
          skipPersistRef.current=true;
          setSchools(mapped);
        } else {
          const id=genId();
          const one=schoolShape(id,"School 1");
          skipPersistRef.current=true;
          setSchools([one]);
          try{ await upsertSchool(one); }catch(e){ console.warn("Supabase insert default school",e); }
        }
        setLoadedFromDb(true);
      })
      .catch(()=>setLoadedFromDb(true));
    return ()=>{ cancelled=true; };
  },[]);

  useEffect(()=>{
    if(loadedFromDb&&schools.length>0&&!schools.some(s=>s.id===activeSchoolId))
      setActiveSchoolId(schools[0].id);
  },[loadedFromDb,schools,activeSchoolId]);

  useEffect(()=>{
    if(!loadedFromDb||!SUPABASE_ENABLED||skipPersistRef.current){ skipPersistRef.current=false; return; }
    schools.forEach(s=>{
      upsertSchool(s).catch(err=>console.warn("Supabase upsert error",err));
    });
  },[schools,loadedFromDb]);

  useEffect(()=>{ try{ if(activeSchoolId) localStorage.setItem("activeSchoolId",activeSchoolId); }catch(e){} },[activeSchoolId]);

  useEffect(()=>{
    if(!loadedFromDb) return;
    saveToLocal(schools,activeSchoolId);
  },[loadedFromDb,schools,activeSchoolId]);

  const setSettingsForActive=(updater)=>{
    setSchools(prev=>prev.map(s=>s.id===activeSchoolId
      ? {...s,settings:typeof updater==="function"?updater(s.settings):updater}
      : s));
  };
  const setStudentsForActive=(updater)=>{
    setSchools(prev=>prev.map(s=>s.id===activeSchoolId
      ? {...s,students:typeof updater==="function"?updater(s.students):updater}
      : s));
  };

  const addSchool=()=>{
    setSchools(prev=>{
      const id=genId();
      const idx=prev.length+1;
      const next=[...prev,schoolShape(id,`School ${idx}`)];
      setActiveSchoolId(id);
      return next;
    });
  };

  const removeSchool=(id)=>{
    setSchools(prev=>{
      if(prev.length<=1) return prev;
      const filtered=prev.filter(s=>s.id!==id);
      const arr=filtered.length?filtered:prev;
      if(id===activeSchoolId){
        const nextId=arr[0]?.id||null;
        setActiveSchoolId(nextId);
      }
      if(SUPABASE_ENABLED) deleteSchool(id).catch(e=>console.warn("Supabase delete error",e));
      return filtered;
    });
  };

  const resetAll=()=>{
    setSchools(prev=>prev.map(s=>s.id===activeSchoolId?{...s,settings:defaultSettings,students:defaultStudents}:s));
    setPage("dashboard");
    window.location.reload();
  };
  const nav=[{id:"dashboard",l:"Dashboard",i:"🏠"},{id:"timetable",l:"Timetable",i:"📅"},{id:"attendance",l:"Attendance",i:"📋"},{id:"examination",l:"Examination",i:"📝"},{id:"paper",l:"Paper Generator",i:"📄"},{id:"settings",l:"Settings",i:"⚙️"}];
  return <>
    <style>{PRINT_CSS}</style>
    <div style={{display:"flex",minHeight:"100vh",fontFamily:"'Segoe UI',Tahoma,Geneva,Verdana,sans-serif",background:"#e5edf7"}}>
      <div style={{width:200,background:C.navy,color:"#fff",display:"flex",flexDirection:"column",boxShadow:"4px 0 12px rgba(0,0,0,0.2)",flexShrink:0}}>
        <div style={{padding:"12px 10px",borderBottom:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",gap:10}}>
          {settings.logo?<img src={settings.logo} style={{width:36,height:36,borderRadius:"50%",objectFit:"cover"}}/>
            :<div style={{width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>★</div>}
          <div style={{overflow:"hidden"}}>
            <div style={{fontWeight:700,fontSize:11,lineHeight:1.4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{settings.schoolName.split(" ").slice(0,3).join(" ")}</div>
            <div style={{fontSize:9,opacity:0.6}}>{settings.schoolCode}</div>
          </div>
        </div>
        <nav style={{flex:1,padding:"6px 0"}}>
          {nav.map(item=><button key={item.id} onClick={()=>setPage(item.id)} style={{width:"100%",padding:"8px 12px",background:page===item.id?"rgba(255,255,255,0.15)":"transparent",border:"none",color:"#fff",cursor:"pointer",textAlign:"left",fontSize:13,display:"flex",alignItems:"center",gap:9,borderLeft:page===item.id?"4px solid #fbbf24":"4px solid transparent"}}>
            <span>{item.i}</span>{item.l}
          </button>)}
        </nav>
        <div style={{padding:"8px 10px",borderTop:"1px solid rgba(255,255,255,0.1)",fontSize:10,opacity:0.7,lineHeight:1.4}}>{settings.principalName}<br/>Principal / Headmaster</div>
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
        <div className="no-print" style={{background:"#fff",padding:"8px 18px",borderBottom:"1px solid #e5e7eb",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
          <h1 style={{margin:0,fontSize:17,color:C.navy,fontFamily:"Georgia,serif"}}>{nav.find(n=>n.id===page)?.i} {nav.find(n=>n.id===page)?.l}</h1>
          <span style={{fontSize:12,color:C.gray}}>{new Date().toLocaleDateString("en-PK",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</span>
        </div>
        <div id="print-section" style={{flex:1,padding:18,overflow:"auto"}}>
          {page==="dashboard"&&<DashboardPage settings={settings} students={students}/>}
          {page==="timetable"&&<TimetablePage settings={settings} timetable={timetable} setTimetable={setTimetable}/>}
          {page==="attendance"&&<AttendancePage settings={settings} students={students}/>}
          {page==="examination"&&<ExaminationPage settings={settings} setSettings={setSettingsForActive} students={students} setStudents={setStudentsForActive} timetable={timetable}/>}
          {page==="paper"&&<PaperGeneratorPage settings={settings}/>}
          {page==="settings"&&<SettingsPage settings={settings} setSettings={setSettingsForActive} resetAll={resetAll} students={students} setStudents={setStudentsForActive} schools={schools} activeSchoolId={activeSchoolId} setActiveSchoolId={setActiveSchoolId} addSchool={addSchool} removeSchool={removeSchool}/>}
        </div>
      </div>
    </div>
  </>;
}

export default App;
