/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Check, 
  Terminal as TerminalIcon, 
  Calendar as CalendarIcon, 
  Flame, 
  TrendingUp, 
  User, 
  ChevronRight, 
  ChevronLeft, 
  Sun, 
  Moon, 
  Coffee,
  Brain,
  Book,
  Clock,
  Eye,
  Activity,
  BarChart3,
  CalendarDays,
  Lock,
  Zap,
  LogOut,
  CreditCard,
  QrCode,
  ShieldCheck,
  History,
  Plus,
  Trash2,
  Edit3,
  FileText,
  Paperclip,
  X,
  ExternalLink,
  MoreVertical
} from 'lucide-react';
import { 
  format, 
  addDays, 
  startOfWeek, 
  eachDayOfInterval, 
  isSameDay, 
  subDays,
  isToday
} from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  onAuthStateChanged, 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  collection, 
  query, 
  where,
  OperationType,
  handleFirestoreError,
  FirebaseUser,
  Timestamp
} from './firebase';
import { deleteDoc, updateDoc } from 'firebase/firestore';

// --- Types ---

type Category = 'Morning' | 'Deep Work' | 'Wind Down';
type Frequency = 'daily' | 'one-time';

interface Attachment {
  name: string;
  type: string;
  content: string;
}

interface Habit {
  id: string;
  uid: string;
  title: string;
  description: string;
  category: Category;
  frequency: Frequency;
  streak: number;
  attachments?: Attachment[];
  createdAt: string;
}

type Tab = 'habits' | 'stats' | 'profile';

interface UserProfile {
  uid: string;
  email: string;
  role: 'admin' | 'user';
  isSubscribed: boolean;
  subscriptionExpiry?: string;
  createdAt: string;
}

// --- Constants ---

const ADMIN_EMAIL = "2022520080.deepayan@ug.sharda.ac.in";

const CATEGORIES: Category[] = ['Morning', 'Deep Work', 'Wind Down'];

// --- Main Component ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [completions, setCompletions] = useState<Record<string, string[]>>({});
  const [authReady, setAuthReady] = useState(false);
  
  const [activeTab, setActiveTab] = useState<Tab>('habits');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  
  const [showHabitModal, setShowHabitModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [showPayment, setShowPayment] = useState(false);

  // Sync Theme
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark';
    if (savedTheme) {
      setTheme(savedTheme);
      if (savedTheme === 'dark') document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Fetch or create profile
        const userRef = doc(db, 'users', u.uid);
        const snap = await getDoc(userRef);
        
        if (!snap.exists()) {
          const newProfile: UserProfile = {
            uid: u.uid,
            email: u.email || '',
            role: u.email === ADMIN_EMAIL ? 'admin' : 'user',
            isSubscribed: false,
            createdAt: new Date().toISOString()
          };
          try {
            await setDoc(userRef, newProfile);
            setProfile(newProfile);
          } catch (e) {
            handleFirestoreError(e, OperationType.WRITE, `users/${u.uid}`);
          }
        } else {
          setProfile(snap.data() as UserProfile);
        }
      } else {
        setProfile(null);
        setHabits([]);
        setCompletions({});
      }
      setAuthReady(true);
    });
  }, []);

  // Real-time habits sync
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'habits'), where('uid', '==', user.uid));
    return onSnapshot(q, (snapshot) => {
      const data: Habit[] = [];
      snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() } as Habit);
      });
      setHabits(data);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'habits'));
  }, [user]);

  // Real-time completions sync
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'completions'), where('uid', '==', user.uid));
    return onSnapshot(q, (snapshot) => {
      const data: Record<string, string[]> = {};
      snapshot.forEach(doc => {
        const d = doc.data();
        data[d.date] = d.completedHabitIds;
      });
      setCompletions(data);
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'completions'));
  }, [user]);

  const toggleHabit = async (habitId: string) => {
    if (!user) return;
    const dateKey = format(selectedDate, 'yyyy-MM-dd');
    const existing = completions[dateKey] || [];
    const isDone = existing.includes(habitId);
    
    const newIds = isDone 
      ? existing.filter(id => id !== habitId)
      : [...existing, habitId];
      
    const docId = `${user.uid}_${dateKey}`;
    
    try {
      // Update completions
      await setDoc(doc(db, 'completions', docId), {
        uid: user.uid,
        date: dateKey,
        completedHabitIds: newIds,
        updatedAt: new Date().toISOString()
      });

      // Update streak if daily and done on CURRENT day
      const habit = habits.find(h => h.id === habitId);
      if (habit && habit.frequency === 'daily' && isSameDay(selectedDate, new Date())) {
        const newStreak = isDone ? Math.max(0, habit.streak - 1) : habit.streak + 1;
        await updateDoc(doc(db, 'habits', habitId), { streak: newStreak });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, docId);
    }
  };

  const saveHabit = async (habitData: Partial<Habit>) => {
    if (!user) return;
    const habitId = editingHabit ? editingHabit.id : doc(collection(db, 'habits')).id;
    const finalHabit = {
      ...habitData,
      id: habitId,
      uid: user.uid,
      streak: habitData.streak ?? 0,
      createdAt: habitData.createdAt ?? new Date().toISOString()
    };
    try {
      await setDoc(doc(db, 'habits', habitId), finalHabit);
      setShowHabitModal(false);
      setEditingHabit(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `habits/${habitId}`);
    }
  };

  const deleteHabit = async (habitId: string) => {
    if (!window.confirm("Are you sure you want to delete this habit?")) return;
    try {
      await deleteDoc(doc(db, 'habits', habitId));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `habits/${habitId}`);
    }
  };

  const isSubscribed = profile?.role === 'admin' || profile?.isSubscribed;
  const currentCompletions = completions[format(selectedDate, 'yyyy-MM-dd')] || [];

  if (!authReady) return <LoadingScreen />;

  if (!user) return <LoginView login={() => signInWithPopup(auth, googleProvider)} theme={theme} toggleTheme={toggleTheme} />;

  return (
    <div className="min-h-screen max-w-5xl mx-auto bg-bento-bg flex flex-col p-6 md:p-8 font-sans selection:bg-bento-accent/20">
      <Header 
        user={user} 
        profile={profile} 
        selectedDate={selectedDate} 
        score={Math.round((currentCompletions.length / Math.max(habits.length, 1)) * 1000)}
        isSubscribed={isSubscribed}
        setActiveTab={setActiveTab}
        activeTab={activeTab}
      />

      <Nav 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        theme={theme} 
        toggleTheme={toggleTheme} 
      />

      <main className="flex-1">
        <AnimatePresence mode="wait">
          {activeTab === 'habits' ? (
            <HabitsView 
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              habits={habits}
              completions={completions}
              currentCompletions={currentCompletions}
              toggleHabit={toggleHabit}
              isSubscribed={isSubscribed}
              onUpgrade={() => setShowPayment(true)}
              onAddHabit={() => { setEditingHabit(null); setShowHabitModal(true); }}
              onEditHabit={(h) => { setEditingHabit(h); setShowHabitModal(true); }}
              onDeleteHabit={deleteHabit}
            />
          ) : activeTab === 'stats' ? (
            <StatsView 
              completions={completions} 
              isSubscribed={isSubscribed}
              onUpgrade={() => setShowPayment(true)}
            />
          ) : (
            <ProfileView 
              user={user} 
              profile={profile} 
              logout={() => auth.signOut()} 
              isSubscribed={isSubscribed}
              onUpgrade={() => setShowPayment(true)}
            />
          )}
        </AnimatePresence>
      </main>

      <HabitModal 
        isOpen={showHabitModal} 
        onClose={() => { setShowHabitModal(false); setEditingHabit(null); }} 
        onSave={saveHabit}
        initialData={editingHabit}
      />

      <PaymentModal 
        isOpen={showPayment} 
        onClose={() => setShowPayment(false)} 
        onSuccess={async () => {
          if (!user || !profile) return;
          const updated = { ...profile, isSubscribed: true, subscriptionExpiry: addDays(new Date(), 365).toISOString() };
          await setDoc(doc(db, 'users', user.uid), updated);
          setProfile(updated);
          setShowPayment(false);
        }} 
      />
    </div>
  );
}

// --- Views ---

function HabitsView({ 
  selectedDate, setSelectedDate, habits, completions, currentCompletions, toggleHabit, isSubscribed, onUpgrade, onAddHabit, onEditHabit, onDeleteHabit 
}: any) {
  const weekDays = useMemo(() => {
    const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, [selectedDate]);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 bento-card flex flex-col h-full">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-bold text-xs uppercase tracking-widest text-bento-text-sub">My Routine</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedDate(subDays(selectedDate, 1))} className="p-1 hover:bg-bento-bg rounded-md"><ChevronLeft size={16} /></button>
            <span className="text-xs font-bold text-bento-accent bg-bento-accent-light px-2 py-1 rounded-md">{format(selectedDate, 'MMM d')}</span>
            <button onClick={() => setSelectedDate(addDays(selectedDate, 1))} className="p-1 hover:bg-bento-bg rounded-md"><ChevronRight size={16} /></button>
          </div>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto pr-2 custom-scrollbar">
          {habits.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-12 space-y-4">
              <div className="p-4 bg-bento-bg rounded-full"><Plus size={32} className="text-bento-text-sub" /></div>
              <p className="font-bold text-bento-text-sub">No habits found. Time to build your routine!</p>
              <button onClick={onAddHabit} className="bento-pill bg-bento-accent text-white px-6">Create your first Habit</button>
            </div>
          ) : (
            CATEGORIES.map((cat, idx) => {
              const catHabits = habits.filter((h: Habit) => h.category === cat);
              if (catHabits.length === 0) return null;
              const isLocked = !isSubscribed && idx > 0;

              return (
                <section key={cat} className={cn("space-y-4 relative", isLocked && "opacity-40 select-none cursor-not-allowed")}>
                  {isLocked && (
                    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                      <button onClick={onUpgrade} className="bg-bento-accent text-white px-4 py-2 rounded-xl flex items-center gap-2 font-bold shadow-xl animate-pulse pointer-events-auto">
                        <Lock size={14} /> Unlock Max Plan
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-bento-accent font-bold text-sm">
                    {cat === 'Morning' ? <Sun size={16}/> : cat === 'Deep Work' ? <TerminalIcon size={16}/> : <Moon size={16}/>}
                    {cat}
                  </div>

                  <div className="space-y-3">
                    {catHabits.map((habit: Habit) => {
                      const isDone = currentCompletions.includes(habit.id);
                      return (
                        <HabitCard 
                          key={habit.id} 
                          habit={habit} 
                          isDone={isDone} 
                          onToggle={() => toggleHabit(habit.id)} 
                          onEdit={() => onEditHabit(habit)}
                          onDelete={() => onDeleteHabit(habit.id)}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>

      <div className="space-y-6">
        <button onClick={onAddHabit} className="w-full bento-card bg-bento-accent text-white p-6 flex flex-col items-center justify-center gap-2 group">
           <div className="p-3 bg-white/20 rounded-full group-hover:scale-110 transition-transform"><Plus size={24} /></div>
           <p className="font-bold">Add New Habit</p>
        </button>

        <div className="bento-card">
          <h3 className="font-bold text-xs uppercase tracking-widest text-bento-text-sub mb-4">Calendar</h3>
          <div className="grid grid-cols-7 gap-1">
             {weekDays.map(day => {
               const isActive = isSameDay(day, selectedDate);
               const dayCompletions = completions[format(day, 'yyyy-MM-dd')] || [];
               return (
                 <button 
                   key={day.toISOString()}
                   onClick={() => setSelectedDate(day)}
                   className={cn("aspect-square rounded-lg flex flex-col items-center justify-center text-[10px]", isActive ? "bg-bento-accent text-white shadow-lg" : "hover:bg-bento-bg")}
                 >
                   <span className="opacity-60">{format(day, 'EEE')[0]}</span>
                   <span className="font-bold">{format(day, 'd')}</span>
                   {dayCompletions.length > 0 && <div className="w-1 h-1 rounded-full mt-1 bg-emerald-400" />}
                 </button>
               );
             })}
          </div>
        </div>

        <div className="bento-card bg-slate-900 text-white overflow-hidden relative">
          <Zap size={80} className="absolute -right-4 -top-4 opacity-10 rotate-12" />
          <h4 className="text-lg font-bold mb-2">Quote of the Day</h4>
          <p className="text-sm text-slate-400 italic font-medium leading-relaxed">
            "Your habits are the atoms of your life. Each one is a fundamental unit that contributes to your overall improvement."
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// --- Components ---

function HabitCard({ habit, isDone, onToggle, onEdit, onDelete }: any) {
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="group relative bento-card !p-4 hover:shadow-md transition-all">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1 cursor-pointer" onClick={onToggle}>
          <div className={cn(
            "w-8 h-8 flex items-center justify-center rounded-xl border-2 transition-all shrink-0",
            isDone ? "bg-bento-accent border-bento-accent text-white" : "border-bento-border bg-bento-card"
          )}>
            {isDone && <Check size={18} strokeWidth={3} />}
          </div>
          <div className="flex-1">
            <h4 className={cn("text-sm font-bold transition-all", isDone && "text-bento-text-sub line-through opacity-60")}>{habit.title}</h4>
            {habit.description && <p className="text-[10px] text-bento-text-sub mt-0.5 line-clamp-1">{habit.description}</p>}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {habit.frequency === 'daily' ? (
             <div className="flex items-center gap-1.5 bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 px-2 py-0.5 rounded-full text-[10px] font-black">
               <Flame size={12} fill="currentColor" /> {habit.streak}
             </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full text-[10px] font-black">
              <Zap size={12} fill="currentColor" /> ALL TIME
            </div>
          )}
          
          <div className="relative">
            <button onClick={() => setShowMenu(!showMenu)} className="p-1 text-bento-text-sub hover:bg-bento-bg rounded-md">
              <MoreVertical size={14} />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-bento-card border border-bento-border shadow-xl rounded-xl py-1 min-w-[100px] overflow-hidden">
                  <button onClick={() => { onEdit(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs font-bold flex items-center gap-2 hover:bg-bento-bg">
                    <Edit3 size={12} /> Edit
                  </button>
                  <button onClick={() => { onDelete(); setShowMenu(false); }} className="w-full px-3 py-2 text-left text-xs font-bold text-red-500 flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-950">
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      
      {habit.attachments && habit.attachments.length > 0 && (
        <div className="mt-3 pt-3 border-t border-bento-border/50 flex flex-wrap gap-2">
           {habit.attachments.map((att, i) => (
             <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-bento-bg rounded-lg text-[9px] font-bold text-bento-text-sub">
               <Paperclip size={10} /> {att.name.length > 15 ? att.name.substring(0, 15) + '...' : att.name}
             </div>
           ))}
        </div>
      )}
    </div>
  );
}

function HabitModal({ isOpen, onClose, onSave, initialData }: { isOpen: boolean, onClose: () => void, onSave: (d: any) => void, initialData?: Habit | null }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState<Category>('Morning');
  const [freq, setFreq] = useState<Frequency>('daily');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [newAttName, setNewAttName] = useState('');
  const [newAttContent, setNewAttContent] = useState('');

  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title);
      setDesc(initialData.description);
      setCat(initialData.category);
      setFreq(initialData.frequency);
      setAttachments(initialData.attachments || []);
    } else {
      setTitle('');
      setDesc('');
      setCat('Morning');
      setFreq('daily');
      setAttachments([]);
    }
  }, [initialData, isOpen]);

  const addAttachment = () => {
    if (!newAttName) return;
    setAttachments([...attachments, { name: newAttName, type: 'text', content: newAttContent }]);
    setNewAttName('');
    setNewAttContent('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-md bg-black/20 dark:bg-black/40">
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="bento-card w-full max-w-xl max-h-[90vh] overflow-y-auto custom-scrollbar space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-black tracking-tighter">{initialData ? 'EDIT HABIT' : 'NEW HABIT'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-bento-bg rounded-xl transition-colors"><X size={24} /></button>
        </div>

        <div className="space-y-4">
          <input 
            placeholder="What habit will you master?" 
            value={title} 
            onChange={(e) => setTitle(e.target.value)}
            className="w-full text-xl font-bold bg-bento-bg border-2 border-transparent focus:border-bento-accent rounded-2xl px-5 py-4 outline-none transition-all"
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black tracking-widest text-bento-text-sub ml-1">Category</label>
              <select value={cat} onChange={(e) => setCat(e.target.value as Category)} className="w-full bg-bento-bg font-bold rounded-xl px-4 py-3 outline-none border-2 border-transparent focus:border-bento-accent">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-black tracking-widest text-bento-text-sub ml-1">Frequency</label>
              <div className="flex bg-bento-bg p-1 rounded-xl">
                 <button onClick={() => setFreq('daily')} className={cn("flex-1 py-2 text-xs font-bold rounded-lg transition-all", freq === 'daily' ? "bg-bento-accent text-white shadow-sm" : "text-bento-text-sub")}>DAILY</button>
                 <button onClick={() => setFreq('one-time')} className={cn("flex-1 py-2 text-xs font-bold rounded-lg transition-all", freq === 'one-time' ? "bg-bento-accent text-white shadow-sm" : "text-bento-text-sub")}>ONCE</button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
             <label className="text-[10px] uppercase font-black tracking-widest text-bento-text-sub ml-1">Description</label>
             <textarea 
               placeholder="Why are you doing this?" 
               value={desc}
               onChange={(e) => setDesc(e.target.value)}
               className="w-full bg-bento-bg font-medium rounded-2xl px-5 py-4 outline-none border-2 border-transparent focus:border-bento-accent min-h-[100px] resize-none"
             />
          </div>

          <div className="space-y-4 pt-4 border-t border-bento-border">
             <div className="flex items-center gap-2 mb-2">
                <Paperclip size={14} className="text-bento-accent" />
                <h3 className="text-xs font-black uppercase tracking-widest">Attachments</h3>
             </div>
             
             <div className="space-y-3">
               {attachments.map((att, i) => (
                 <div key={i} className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-xl border border-bento-border">
                    <div className="flex items-center gap-3">
                       <FileText size={16} className="text-bento-text-sub" />
                       <div>
                          <p className="text-xs font-bold">{att.name}</p>
                          {att.content && <p className="text-[9px] text-bento-text-sub truncate max-w-[200px]">{att.content}</p>}
                       </div>
                    </div>
                    <button onClick={() => setAttachments(attachments.filter((_, idx) => idx !== i))} className="p-1 text-red-500 hover:bg-red-50 rounded-md">
                       <Trash2 size={14} />
                    </button>
                 </div>
               ))}
             </div>

             <div className="p-4 bg-bento-bg rounded-2xl space-y-3">
                <input placeholder="Attachment Name (e.g. Reference Plan)" value={newAttName} onChange={(e) => setNewAttName(e.target.value)} className="w-full bg-white dark:bg-slate-800 px-4 py-2 rounded-lg text-xs font-bold outline-none border border-bento-border" />
                <textarea placeholder="Paste text reference or link here" value={newAttContent} onChange={(e) => setNewAttContent(e.target.value)} className="w-full bg-white dark:bg-slate-800 px-4 py-2 rounded-lg text-xs font-medium outline-none border border-bento-border resize-none h-20" />
                <button onClick={addAttachment} className="w-full py-2 bg-bento-text-main text-bento-card text-[10px] font-black uppercase tracking-widest rounded-lg">Add Reference</button>
             </div>
          </div>
        </div>

        <button 
          onClick={() => onSave({ title, description: desc, category: cat, frequency: freq, attachments, streak: initialData?.streak ?? 0, createdAt: initialData?.createdAt ?? new Date().toISOString() })}
          disabled={!title}
          className="w-full py-5 bg-bento-accent text-white font-black text-lg rounded-2xl bento-btn shadow-lg disabled:opacity-50"
        >
          {initialData ? 'UPDATE HABIT' : 'ESTABLISH HABIT'}
        </button>
      </motion.div>
    </div>
  );
}

// --- Logic/Stat Components ---

function Header({ user, profile, selectedDate, score, isSubscribed, setActiveTab, activeTab }: any) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div className="md:col-span-3 bento-card flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <div className="flex gap-2">
            <div className="bento-pill mb-2"><CalendarIcon size={14} /> {format(selectedDate, 'LLLL d, yyyy')}</div>
            {profile?.role === 'admin' && <div className="bento-pill mb-2 bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">Admin</div>}
            {isSubscribed && profile?.role !== 'admin' && <div className="bento-pill mb-2 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Max Plan</div>}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Stay Disciplined, {user.displayName?.split(' ')[0]} ⚡</h1>
        </div>
        <div className="text-center md:text-right">
           <p className="text-[10px] font-black uppercase tracking-widest text-bento-text-sub">Success Rate</p>
           <p className="text-3xl font-black text-bento-accent">{score}/1000</p>
        </div>
      </div>
      <div onClick={() => setActiveTab('profile')} className={cn("bento-card cursor-pointer flex items-center gap-4 hover:shadow-md", activeTab === 'profile' && "ring-2 ring-bento-accent")}>
        <div className="w-12 h-12 rounded-full bg-bento-accent-light flex items-center justify-center font-bold text-bento-accent overflow-hidden border-2 border-bento-card">
           {user.photoURL ? <img src={user.photoURL} alt="p" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : 'UP'}
        </div>
        <div className="truncate"><p className="font-black text-sm truncate">{user.displayName || 'User'}</p><p className="text-[10px] font-bold text-bento-text-sub uppercase">{isSubscribed ? 'Master' : 'Amateur'}</p></div>
      </div>
    </div>
  );
}

function Nav({ activeTab, setActiveTab, theme, toggleTheme }: any) {
  return (
    <div className="flex justify-between items-center mb-6">
      <div className="flex gap-2">
        {(['habits', 'stats', 'profile'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={cn("bento-pill bento-btn px-6 py-3 font-black uppercase text-xs tracking-widest", activeTab === tab ? "bg-bento-accent text-white shadow-xl" : "bg-bento-card")}>{tab}</button>
        ))}
      </div>
      <button onClick={toggleTheme} className="p-3 bento-card !p-3 hover:bg-bento-accent hover:text-white transition-all shadow-sm">{theme === 'light' ? <Moon size={20}/> : <Sun size={20}/>}</button>
    </div>
  );
}

function ProfileView({ user, profile, logout, isSubscribed, onUpgrade }: any) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
      <div className="bento-card flex flex-col items-center py-12 text-center">
        <div className="w-32 h-32 rounded-3xl border-4 border-bento-card shadow-2xl overflow-hidden mb-6 rotate-3">
          {user.photoURL ? <img src={user.photoURL} alt="p" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <User size={64}/>}
        </div>
        <h2 className="text-3xl font-black italic">{user.displayName}</h2>
        <p className="text-bento-text-sub font-bold uppercase tracking-widest text-[10px] mt-2">{profile?.role === 'admin' ? 'Root Administrator' : isSubscribed ? 'Elite Continuity Member' : 'Standard Routine Member'}</p>
        <div className="flex gap-3 mt-8">
           <button onClick={logout} className="px-8 py-4 bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-black rounded-2xl text-xs flex items-center gap-2 uppercase tracking-widest bento-btn"><LogOut size={16}/> Exit Session</button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="bento-card h-full">
          <h3 className="font-black text-xs uppercase mb-8 tracking-widest text-bento-text-sub underline decoration-bento-accent decoration-2 underline-offset-4">Membership Status</h3>
          {isSubscribed ? (
            <div className="flex items-center gap-6 p-6 bg-emerald-50 dark:bg-emerald-900/10 rounded-3xl border border-emerald-100 dark:border-emerald-800">
               <ShieldCheck className="text-emerald-500" size={48} />
               <div className="space-y-1">
                  <p className="font-black text-xl italic text-emerald-800 dark:text-emerald-300">MAX PLAN ACTIVE</p>
                  <p className="text-xs font-bold text-emerald-700/60 dark:text-emerald-500 uppercase tracking-widest">Full System Access Granted</p>
               </div>
            </div>
          ) : (
            <div className="bg-bento-bg rounded-3xl p-6 space-y-4">
              <div className="flex gap-4">
                 <div className="p-3 bg-white dark:bg-slate-800 rounded-2xl"><Zap className="text-bento-accent" /></div>
                 <div>
                    <h4 className="font-black">Unlock Elite Performance</h4>
                    <p className="text-xs font-medium text-bento-text-sub mt-1">₹59 / Forever. No recurrent drain.</p>
                 </div>
              </div>
              <button onClick={onUpgrade} className="w-full py-4 bg-bento-accent text-white font-black rounded-2xl shadow-lg bento-btn text-sm uppercase tracking-widest">Upgrade to Max</button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StatsView({ completions, isSubscribed, onUpgrade }: any) {
  const daysTracked = Object.keys(completions).length;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 pb-12">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-4">
           <div className="bento-card flex flex-col items-center py-10">
              <Activity size={32} className="text-bento-accent mb-4" />
              <p className="text-5xl font-black italic">{daysTracked}</p>
              <p className="text-[10px] uppercase font-black text-bento-text-sub tracking-widest mt-2">Days Logged</p>
           </div>
           {!isSubscribed && (
             <div className="bento-card flex flex-col items-center py-16 bg-bento-bg border-dashed border-2 border-bento-border text-center">
                <Lock size={40} className="text-bento-text-sub mb-4" />
                <p className="text-[10px] font-black text-bento-text-sub uppercase tracking-[0.2em]">Deep Analytics Locked</p>
                <button onClick={onUpgrade} className="mt-6 text-bento-accent text-sm font-black underline uppercase tracking-widest">Access System</button>
             </div>
           )}
        </div>

        <div className={cn("md:col-span-2 space-y-6", !isSubscribed && "opacity-40 blur-md select-none pointer-events-none")}>
           <div className="bento-card">
              <div className="flex items-center justify-between mb-8">
                <h3 className="font-black text-xs uppercase tracking-widest text-bento-text-sub underline decoration-bento-accent decoration-2 underline-offset-4">Contribution System</h3>
                <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500" /><span className="text-[10px] font-black uppercase text-emerald-600">Active</span></div>
              </div>
              <ContributionGraph completions={completions} />
           </div>
        </div>
      </div>
    </motion.div>
  );
}

// --- Utils ---

function LoadingScreen() {
  return <div className="min-h-screen flex items-center justify-center bg-bento-bg flex-col gap-4">
    <div className="w-16 h-1 w-32 bg-bento-accent rounded-full animate-pulse" />
    <span className="text-[10px] font-black uppercase tracking-[0.5em] text-bento-accent">Initializing System</span>
  </div>;
}

function LoginView({ login, theme, toggleTheme }: { login: () => void; theme: string; toggleTheme: () => void }) {
  return (
    <div className="min-h-screen bg-bento-bg flex flex-col items-center justify-center p-6 text-center">
      <div className="bento-card max-w-md w-full py-16 space-y-10 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.1)]">
        <div className="w-24 h-24 bg-bento-accent-light rounded-[32px] flex items-center justify-center mx-auto shadow-xl rotate-6">
          <Activity size={48} className="text-bento-accent" />
        </div>
        <div className="space-y-3">
          <h1 className="text-5xl font-black tracking-tighter italic">INIT SYSTEMS</h1>
          <p className="text-bento-text-sub font-bold uppercase tracking-widest text-xs">High Frequency Routine Management</p>
        </div>
        <button 
          onClick={login}
          className="w-full flex items-center justify-center gap-4 bg-bento-accent text-white font-black py-5 rounded-2xl bento-btn shadow-2xl text-lg italic"
        >
          <Zap size={24} /> ACTIVATE ACCOUNT
        </button>
        <div className="pt-6 border-t border-bento-border text-[9px] font-black text-bento-text-sub uppercase tracking-[0.4em] leading-loose">
          Secure habit sync via Firebase Enterprise v4.1
        </div>
      </div>
      <button 
        onClick={toggleTheme}
        className="mt-12 p-4 bento-card !p-4 hover:bg-bento-accent hover:text-white transition-all shadow-xl"
      >
        {theme === 'light' ? <Moon size={24}/> : <Sun size={24}/>}
      </button>
    </div>
  );
}

function PaymentModal({ isOpen, onClose, onSuccess }: any) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 backdrop-blur-xl bg-white/40 dark:bg-black/40">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bento-card max-w-sm w-full space-y-10 bg-bento-card border-4 border-bento-accent shadow-[0_0_50px_rgba(45,106,79,0.3)]">
        <div className="text-center space-y-2">
          <h3 className="text-3xl font-black tracking-tighter uppercase italic">System Access</h3>
          <p className="text-bento-text-sub font-black text-xs tracking-widest">₹59 LIFETIME ENROLLMENT</p>
        </div>
        <div className="bg-white dark:bg-slate-800 p-8 rounded-[32px] flex flex-col items-center gap-6 shadow-inner border border-bento-border">
           <QrCode size={180} className="text-bento-text-main" />
           <p className="bg-bento-bg dark:bg-slate-900 px-6 py-3 rounded-2xl font-mono text-xs font-black tracking-wider border border-bento-border text-bento-accent">upi: deepayan@sharda</p>
        </div>
        <div className="space-y-3">
          <button onClick={onSuccess} className="w-full py-5 bg-bento-accent text-white font-black rounded-2xl bento-btn shadow-xl text-lg italic">DECLARE SUCCESS</button>
          <button onClick={onClose} className="w-full py-2 text-bento-text-sub font-black text-[10px] uppercase tracking-[0.3em] hover:text-red-500 transition-colors">Abort Upgrade</button>
        </div>
      </motion.div>
    </div>
  );
}

function ContributionGraph({ completions }: { completions: Record<string, string[]> }) {
  const weeks = 36;
  const today = new Date();
  const grid = useMemo(() => {
    const days = [];
    const startDate = subDays(today, weeks * 7 - 1);
    let current = startDate;
    while (current <= today) { days.push(current); current = addDays(current, 1); }
    const res = [];
    for (let i = 0; i < days.length; i += 7) res.push(days.slice(i, i + 7));
    return res;
  }, [weeks, today]);

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-4 scrollbar-hide">
       {grid.map((week, wIdx) => (
         <div key={wIdx} className="flex flex-col gap-1.5 flex-shrink-0">
            {week.map((day, dIdx) => {
               const key = format(day, 'yyyy-MM-dd');
               const count = completions[key]?.length || 0;
               const intensity = count === 0 ? 0 : count < 2 ? 1 : count < 5 ? 2 : 3;
               return (
                 <div key={dIdx} title={`${format(day, 'MMM d')}: ${count} units`} className={cn("w-3.5 h-3.5 rounded-sm transition-all duration-300", intensity === 0 && "bg-bento-bg", intensity === 1 && "bg-bento-accent/30", intensity === 2 && "bg-bento-accent/60", intensity === 3 && "bg-bento-accent")} />
               );
            })}
         </div>
       ))}
    </div>
  );
}
