import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const names = {claude: 'Claude', codex: 'Codex'};
function label(text, style='ai-text') { return new St.Label({text, style_class:style, y_align:Clutter.ActorAlign.CENTER}); }
function duration(seconds) {
    const mins=Math.max(0,Math.ceil(seconds/60));
    if(mins>=1440)return `${Math.floor(mins/1440)}d ${Math.floor(mins%1440/60)}h`;
    return mins>=60 ? `${Math.floor(mins/60)}h ${mins%60}m` : `${mins}m`;
}
export default class Usage extends Extension {
    enable() {
        this._alive=true;
        this._renderKey=null;
        this._loading=false;
        this._cancellable=new Gio.Cancellable();
        this._button=new PanelMenu.Button(0.0,'AI usage — remaining allowance');
        this._button.add_style_class_name('osaka-ai-panel');
        this._bar=label('Claude —  ·  Codex —','ai-panel-text');
        this._settings=this.getSettings();
        const panelBox=new St.BoxLayout();
        this._icon=new St.Icon({gicon:new Gio.FileIcon({file:this.dir.get_child('icons').get_child('ai-usage-symbolic.svg')}),style_class:'system-status-icon ai-panel-icon'});
        panelBox.add_child(this._icon);
        panelBox.add_child(this._bar);
        this._button.add_child(panelBox);
        this._settingsChanged=this._settings.connect('changed::show-percentages',()=>this._updatePanelMode());
        this._updatePanelMode();
        this._button.menu.box.add_style_class_name('osaka-ai-menu');
        Main.panel.addToStatusArea(this.uuid,this._button,0,'right');
        this._file=Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(),'osaka-ai-usage','usage.json']));
        this._timer=GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,30,()=>{this._load();return GLib.SOURCE_CONTINUE;});
        this._open=this._button.menu.connect('open-state-changed',(_m,open)=>{if(open)this._load();});
        this._load();
    }
    _updatePanelMode() {
        const show=this._settings.get_boolean('show-percentages');
        this._bar.visible=show;
        this._icon.visible=!show;
    }
    _load() {
        if(this._loading)return;
        this._loading=true;
        const cancel=this._cancellable;
        this._file.load_contents_async(cancel,(file,result)=>{
            if(!this._alive || cancel!==this._cancellable)return;
            this._loading=false;
            try {const [ok,bytes]=file.load_contents_finish(result);this._data=ok?JSON.parse(new TextDecoder().decode(bytes)):null;}
            catch {this._data=null;}
            this._render();
        });
    }
    _item(actor) {const item=new PopupMenu.PopupBaseMenuItem({reactive:false,can_focus:false});item.add_child(actor);this._button.menu.addMenuItem(item);}
    _render() {
        const providers=this._data?.providers??{};const now=Date.now()/1000;
        this._bar.text=Object.entries(names).map(([id,name])=>{
            const p=providers[id],w=p?.windows?.[0];
            const stale=p?.error || !p?.updatedAt || now-p.updatedAt>Math.max(120,this._settings.get_int('refresh-minutes')*120) || (w?.resetsAt && w.resetsAt<=now);
            return `${name} ${w?`${Math.round(w.remaining)}%${stale?'*':''}`:'—'}`;
        }).join('  ·  ');
        this._button.accessible_name=`AI usage — remaining allowance: ${this._bar.text}`;
        const renderKey=JSON.stringify(providers)+':'+Math.floor(now/60);
        if(renderKey===this._renderKey)return;
        // Keep the open menu stable: no actor destruction during hover/navigation.
        if(this._button.menu.isOpen && this._renderKey!==null)return;
        this._renderKey=renderKey;
        this._button.menu.removeAll();
        this._item(label('AGENT USAGE','ai-heading'));
        this._item(label('Remaining allowance','ai-muted'));
        for(const [id,name] of Object.entries(names)) {
            this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const box=new St.BoxLayout({vertical:true,x_expand:true,style_class:'ai-provider'});
            box.add_child(label(name,'ai-provider-name'));
            const p=providers[id];
            if(!p?.windows?.length)box.add_child(label(p?.error??'Waiting for first update','ai-muted'));
            for(const w of p?.windows??[]) {
                const row=new St.BoxLayout({x_expand:true,style_class:'ai-row'});
                const title=label(w.label);title.x_expand=true;
                row.add_child(title);row.add_child(label(`${Math.round(w.remaining)}%`,'ai-value'));box.add_child(row);
                // Paint the fill without mutating child geometry during allocation.
                const track=new St.DrawingArea({height:4,x_expand:true,style_class:'ai-track'});
                track.connect('repaint',area=>{
                    const cr=area.get_context();
                    const [width,height]=area.get_surface_size();
                    cr.setSourceRGB(0.196,0.278,0.231);
                    cr.rectangle(0,0,width,height);cr.fill();
                    if(w.remaining<10)cr.setSourceRGB(0.859,0.624,0.612);
                    else cr.setSourceRGB(0.506,0.722,0.659);
                    cr.rectangle(0,0,width*Math.max(0,Math.min(100,w.remaining))/100,height);cr.fill();
                    cr.$dispose();
                });
                box.add_child(track);
                box.add_child(label(w.resetsAt ? (w.resetsAt>now?`Resets in ${duration(w.resetsAt-now)}`:'Reset due · refresh needed'):'Reset time unavailable','ai-muted'));
            }
            if(p?.error&&p?.windows?.length)box.add_child(label(p.error+' · showing last reading','ai-muted'));
            if(p?.updatedAt)box.add_child(label(`Updated ${duration(now-p.updatedAt)} ago`,'ai-updated'));
            this._item(box);
        }
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const refresh=new PopupMenu.PopupMenuItem('Refresh usage');
        refresh.connect('activate',()=>{
            try {Gio.Subprocess.new(['systemctl','--user','start','--no-block','osaka-ai-usage.service'],Gio.SubprocessFlags.NONE);}catch(e){console.error(e);}
        });
        this._button.menu.addMenuItem(refresh);
        this._button.menu.addAction('Settings…',()=>this.openPreferences());
    }
    disable() {
        this._alive=false;
        if(this._settingsChanged)this._settings.disconnect(this._settingsChanged);
        this._settingsChanged=null;
        this._settings=null;
        this._bar=null;
        this._icon=null;
        this._cancellable?.cancel();
        this._cancellable=null;
        if(this._timer)GLib.source_remove(this._timer);
        this._timer=null;this._button?.destroy();this._button=null;this._file=null;
    }
}
