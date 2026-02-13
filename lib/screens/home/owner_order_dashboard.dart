import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../services/order_service.dart';

class OwnerOrderDashboardScreen extends StatefulWidget {
  const OwnerOrderDashboardScreen({super.key});

  @override
  State<OwnerOrderDashboardScreen> createState() =>
      _OwnerOrderDashboardScreenState();
}

class _OwnerOrderDashboardScreenState extends State<OwnerOrderDashboardScreen> {
  final _orderService = OrderService();
  final _searchController = TextEditingController();

  DateTime? _selectedDate;
  DateTime? _selectedMonth;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      initialDate: _selectedDate ?? DateTime.now(),
    );
    if (date != null) setState(() => _selectedDate = date);
  }

  Future<void> _pickMonth() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime(now.year + 1, 12, 31),
      initialDate: _selectedMonth ?? now,
      helpText: 'Select any date in month',
    );
    if (date != null) {
      setState(() => _selectedMonth = DateTime(date.year, date.month, 1));
    }
  }

  bool _matchesFilters(Map<String, dynamic> data) {
    final q = _searchController.text.trim().toLowerCase();
    final orderId = (data['orderId'] ?? '').toString().toLowerCase();
    final phone = (data['customerPhone'] ?? '').toString().toLowerCase();
    final name = (data['customerName'] ?? '').toString().toLowerCase();

    if (q.isNotEmpty &&
        !orderId.contains(q) &&
        !phone.contains(q) &&
        !name.contains(q)) {
      return false;
    }

    final createdAt = (data['createdAt'] as Timestamp?)?.toDate();
    if (_selectedDate != null && createdAt != null) {
      final d = DateTime(createdAt.year, createdAt.month, createdAt.day);
      final selected = DateTime(
        _selectedDate!.year,
        _selectedDate!.month,
        _selectedDate!.day,
      );
      if (d != selected) return false;
    }

    if (_selectedMonth != null && createdAt != null) {
      if (createdAt.year != _selectedMonth!.year ||
          createdAt.month != _selectedMonth!.month) {
        return false;
      }
    }

    if ((_selectedDate != null || _selectedMonth != null) && createdAt == null) {
      return false;
    }

    return true;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Order Dashboard')),
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: _orderService.watchOrdersByStatus('delivered'),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError) {
            return Center(child: Text('Error loading dashboard: ${snapshot.error}'));
          }

          final all = (snapshot.data?.docs ?? []).toList()
            ..sort((a, b) {
              final aTs = a.data()['createdAt'] as Timestamp?;
              final bTs = b.data()['createdAt'] as Timestamp?;
              final aDate = aTs?.toDate() ?? DateTime.fromMillisecondsSinceEpoch(0);
              final bDate = bTs?.toDate() ?? DateTime.fromMillisecondsSinceEpoch(0);
              return bDate.compareTo(aDate);
            });
          final filtered =
              all.where((doc) => _matchesFilters(doc.data())).toList();

          final areaCount = <String, int>{};
          final areaValue = <String, int>{};
          final totalValue = filtered.fold<int>(
            0,
            (acc, doc) => acc + ((doc.data()['total'] ?? 0) as int),
          );
          for (final doc in filtered) {
            final total = (doc.data()['total'] ?? 0) as int;
            final address = doc.data()['deliveryAddress'] as Map<String, dynamic>?;
            final area = (address?['area'] ?? 'Unknown').toString();
            areaCount[area] = (areaCount[area] ?? 0) + 1;
            areaValue[area] = (areaValue[area] ?? 0) + total;
          }

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              TextField(
                controller: _searchController,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Search by Order ID / Phone / Customer Name',
                  border: OutlineInputBorder(),
                ),
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  OutlinedButton.icon(
                    onPressed: _pickDate,
                    icon: const Icon(Icons.calendar_today),
                    label: Text(
                      _selectedDate == null
                          ? 'Date'
                          : '${_selectedDate!.year}-${_selectedDate!.month.toString().padLeft(2, '0')}-${_selectedDate!.day.toString().padLeft(2, '0')}',
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: _pickMonth,
                    icon: const Icon(Icons.date_range),
                    label: Text(
                      _selectedMonth == null
                          ? 'Month'
                          : '${_selectedMonth!.year}-${_selectedMonth!.month.toString().padLeft(2, '0')}',
                    ),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: () {
                      setState(() {
                        _selectedDate = null;
                        _selectedMonth = null;
                        _searchController.clear();
                      });
                    },
                    child: const Text('Clear'),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Card(
                child: ListTile(
                  title: const Text('Completed Orders'),
                  trailing: Text(
                    '${filtered.length}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 20,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Card(
                child: ListTile(
                  title: const Text('Completed Order Value'),
                  trailing: Text(
                    'INR $totalValue',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 20,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'Completed Orders by Area',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              if (areaCount.isEmpty)
                const Card(child: ListTile(title: Text('No orders')))
              else
                ...areaCount.entries.map(
                  (entry) => Card(
                    child: ListTile(
                      title: Text(entry.key),
                      subtitle: Text('Value: INR ${areaValue[entry.key] ?? 0}'),
                      trailing: Text(
                        '${entry.value}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                        ),
                      ),
                    ),
                  ),
                ),
              const SizedBox(height: 16),
              const Text(
                'Completed Order List',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 8),
              if (filtered.isEmpty)
                const Card(child: ListTile(title: Text('No matching orders')))
              else
                ...filtered.map((doc) {
                  final data = doc.data();
                  final orderId = (data['orderId'] ?? doc.id).toString();
                  final phone = (data['customerPhone'] ?? '').toString();
                  final name = (data['customerName'] ?? '').toString();
                  final total = data['total'] ?? 0;
                  final createdAt = (data['createdAt'] as Timestamp?)?.toDate();
                  final dateText = createdAt == null
                      ? '-'
                      : '${createdAt.year}-${createdAt.month.toString().padLeft(2, '0')}-${createdAt.day.toString().padLeft(2, '0')}';
                  return Card(
                    child: ListTile(
                      title: Text('Order: $orderId'),
                      subtitle: Text(
                        'Name: ${name.isEmpty ? '-' : name} | Phone: $phone\n'
                        'Date: $dateText | Total: INR $total',
                      ),
                    ),
                  );
                }),
            ],
          );
        },
      ),
    );
  }
}
