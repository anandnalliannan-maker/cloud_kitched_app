import 'package:flutter/material.dart';

import '../../services/published_menu_service.dart';

class PublishMenuScreen extends StatefulWidget {
  const PublishMenuScreen({
    super.key,
    required this.items,
  });

  final List<Map<String, dynamic>> items;

  @override
  State<PublishMenuScreen> createState() => _PublishMenuScreenState();
}

class _PublishMenuScreenState extends State<PublishMenuScreen> {
  final _service = PublishedMenuService();
  DateTime? _date;
  String _meal = 'breakfast';
  late final Map<String, TextEditingController> _qtyControllers;

  @override
  void initState() {
    super.initState();
    _qtyControllers = {
      for (final item in widget.items)
        item['id'] as String: TextEditingController(text: '1')
    };
  }

  @override
  void dispose() {
    for (final c in _qtyControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      initialDate: DateTime.now(),
    );
    if (picked != null) {
      setState(() => _date = picked);
    }
  }

  Future<void> _pickExpiry() async {
    // Expiry is disabled for now. Intentionally no-op.
  }

  Future<void> _publish() async {
    if (_date == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select date')),
      );
      return;
    }

    final publishItems = <Map<String, dynamic>>[];
    for (final item in widget.items) {
      final id = item['id'] as String;
      final qty = int.tryParse(_qtyControllers[id]!.text.trim()) ?? 0;
      if (qty <= 0) continue;
      publishItems.add({
        'id': id,
        'name': item['name'],
        'price': item['price'],
        'description': item['description'],
        'qty': qty,
      });
    }

    if (publishItems.isEmpty) return;

    await _service.publishMenu(
      date: _date!,
      meal: _meal,
      items: publishItems,
    );

    if (!mounted) return;
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Publish Menu')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ListTile(
            title: Text(
              _date == null
                  ? 'Select date'
                  : 'Date: ${_date!.toLocal().toString().split(' ')[0]}',
            ),
            trailing: const Icon(Icons.calendar_month),
            onTap: _pickDate,
          ),
          const SizedBox(height: 8),
          const Text('Meal type'),
          RadioListTile<String>(
            title: const Text('Breakfast'),
            value: 'breakfast',
            groupValue: _meal,
            onChanged: (value) => setState(() => _meal = value!),
          ),
          RadioListTile<String>(
            title: const Text('Lunch'),
            value: 'lunch',
            groupValue: _meal,
            onChanged: (value) => setState(() => _meal = value!),
          ),
          RadioListTile<String>(
            title: const Text('Snacks'),
            value: 'snacks',
            groupValue: _meal,
            onChanged: (value) => setState(() => _meal = value!),
          ),
          RadioListTile<String>(
            title: const Text('Dinner'),
            value: 'dinner',
            groupValue: _meal,
            onChanged: (value) => setState(() => _meal = value!),
          ),
          const Divider(),
          const Text('Selected items'),
          const SizedBox(height: 8),
          for (final item in widget.items)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      (item['name'] ?? '').toString(),
                      style: const TextStyle(fontSize: 16),
                    ),
                  ),
                  const SizedBox(width: 12),
                  SizedBox(
                    width: 100,
                    child: TextField(
                      controller: _qtyControllers[item['id'] as String],
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Qty',
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          const Divider(),
          ListTile(
            title: Text(
              'Set expiry date & time (coming soon)',
            ),
            trailing: const Icon(Icons.schedule),
            enabled: false,
            onTap: _pickExpiry,
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _date == null ? null : _publish,
              child: const Text('Publish menu'),
            ),
          ),
        ],
      ),
    );
  }
}
