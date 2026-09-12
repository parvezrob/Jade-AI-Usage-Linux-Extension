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
function period(w) {
    if(!w)return '';
    return w.label==='5-hour'?'5h':w.label==='Weekly'?'7d':w.label;
}
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
        this._button=new PanelMenu.Button(0.5,'AI usage — remaining allowance');
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
            return `${name}${w?` ${period(w)}`:''} ${w?`${Math.round(w.remaining)}%${stale?'*':''}`:'—'}`;
        }).join('  ·  ');
        this._button.accessible_name=`AI usage — remaining allowance: ${this._bar.text}`;
        const renderKey=JSON.stringify(providers)+':'+Math.floor(now/60);
        if(renderKey===this._renderKey)return;
        // Keep the open menu stable: no actor destruction during hover/navigation.
        if(this._button.menu.isOpen && this._renderKey!==null)return;
        this._renderKey=renderKey;
        this._button.menu.removeAll();
        const heading=new St.BoxLayout({x_expand:true,style_class:'ai-row'});
        const headingTitle=label('AGENT USAGE','ai-heading');headingTitle.x_expand=true;
        heading.add_child(headingTitle);heading.add_child(label('Remaining','ai-muted'));
        this._item(heading);
        for(const [id,name] of Object.entries(names)) {
            this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const box=new St.BoxLayout({vertical:true,x_expand:true,style_class:'ai-provider'});
            const p=providers[id];
            const header=new St.BoxLayout({x_expand:true,style_class:'ai-provider-header'});
            header.add_child(new St.Icon({gicon:new Gio.FileIcon({file:this.dir.get_child('icons').get_child(`${id==='claude'?'claude':'openai'}-symbolic.svg`)}),style_class:'ai-provider-icon'}));
            const providerTitle=label(name,'ai-provider-name');providerTitle.x_expand=true;
            header.add_child(providerTitle);
            if(p?.updatedAt)header.add_child(label(`${duration(now-p.updatedAt)} ago`,'ai-updated'));
            box.add_child(header);
            if(!p?.windows?.length)box.add_child(label(p?.error??'Waiting for first update','ai-muted'));
            for(const w of p?.windows??[]) {
                const row=new St.BoxLayout({x_expand:true,style_class:'ai-row'});
                const title=label(w.label);title.x_expand=true;
                row.add_child(title);
                const reset=w.resetsAt?(w.resetsAt>now?`↻ ${duration(w.resetsAt-now)}`:'Reset due'):'Reset —';
                const resetLabel=label(reset,'ai-muted');
                resetLabel.accessible_name=w.resetsAt?(w.resetsAt>now?`Resets in ${duration(w.resetsAt-now)}`:'Reset due; refresh needed'):'Reset time unavailable';
                row.add_child(resetLabel);
                row.add_child(label(`${Math.round(w.remaining)}%`,'ai-value'));
                const quota=new St.BoxLayout({vertical:true,x_expand:true,style_class:'ai-quota'});
                quota.add_child(row);box.add_child(quota);
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
                quota.add_child(track);
            }
            if(p?.error&&p?.windows?.length)box.add_child(label(p.error+' · showing last reading','ai-muted'));

            this._item(box);
        }
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const footer=new St.BoxLayout({x_expand:true,style_class:'ai-footer'});
        const addAction=(text,iconName,callback)=>{
            const button=new St.Button({can_focus:true,reactive:true,track_hover:true,x_expand:true,style_class:'ai-action',accessible_name:text});
            const contents=new St.BoxLayout({style_class:'ai-action-content',x_align:Clutter.ActorAlign.CENTER});
            contents.add_child(new St.Icon({icon_name:iconName,icon_size:14}));
            contents.add_child(label(text));button.set_child(contents);
            button.connect('clicked',()=>{this._button.menu.close();callback();});
            footer.add_child(button);
        };
        addAction('Refresh','view-refresh-symbolic',()=>{
            try {Gio.Subprocess.new(['systemctl','--user','start','--no-block','osaka-ai-usage.service'],Gio.SubprocessFlags.NONE);}catch(e){console.error(e);}
        });
        addAction('Settings','emblem-system-symbolic',()=>this.openPreferences());
        this._item(footer);
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
